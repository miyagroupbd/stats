"""Conversations router — per-lead correspondence merged from messages + events.

The board's Replies page showed one event per lead; this router shows the whole
exchange. Every item comes from one of three sources:

- ``messages`` rows with status sent/queued/failed → outbound. ``source`` is
  ``board`` when the row is a ``followup_reply`` (sent from the stats UI via
  ``POST /messages/replies/{lead_id}/send-reply``), otherwise ``pipeline``.
  Drafts (drafted/approved/rejected) are NOT correspondence and are excluded.
- ``events`` of type ``replied`` → inbound, ``source=mailbox``. The captured
  body has its quoted history stripped with ``clean_reply_body``.
- ``events`` of type ``sent_manual`` → outbound, ``source=mailbox``. Written by
  the pipeline's Sent-folder scan for mail a human sent from the mailbox.

Items carrying a Message-ID (``events.meta.imap_message_id`` or
``messages.smtp_message_id``) are deduplicated on it, so a board-sent reply the
Sent-folder scan later re-records as ``sent_manual`` shows once.

Read-only; every route needs an authenticated user (same gate as the rest).
"""
from __future__ import annotations

import email.utils
from datetime import datetime, timezone
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Query, status

from app.core.db import prisma
from app.deps import get_current_user
from app.routers.messages import _resolve_domain_id, clean_reply_body
from app.schemas.conversation import (
    Conversation,
    ConversationCounts,
    ConversationLead,
    ConversationPage,
    ConversationThread,
    ThreadItem,
)

router = APIRouter(prefix="/conversations", tags=["conversations"])

# Message rows that count as real correspondence (anything that left, or tried
# to leave, the building). Drafts never do.
CORRESPONDENCE_MESSAGE_STATUSES = ("sent", "queued", "failed")
# Event types that count as real correspondence.
CORRESPONDENCE_EVENT_TYPES = ("replied", "sent_manual")

PREVIEW_MAX_CHARS = 160

_EPOCH = datetime.min.replace(tzinfo=timezone.utc)


# --------------------------------------------------------------------------- #
# Helpers
# --------------------------------------------------------------------------- #
def _as_utc(value: datetime | None) -> datetime | None:
    """Make naive datetimes comparable with the tz-aware ones Prisma returns."""
    if value is None:
        return None
    if value.tzinfo is None:
        return value.replace(tzinfo=timezone.utc)
    return value


def _parse_rfc2822(value: Any) -> datetime | None:
    """Parse a raw ``Date:`` header; None on anything unparseable."""
    if not isinstance(value, str) or not value.strip():
        return None
    try:
        parsed = email.utils.parsedate_to_datetime(value)
    except Exception:  # ValueError/TypeError/IndexError depending on the input
        return None
    return _as_utc(parsed)


def _norm_message_id(value: Any) -> str | None:
    """Normalise a Message-ID for dedupe: strip whitespace and angle brackets."""
    if not isinstance(value, str):
        return None
    cleaned = value.strip().strip("<>").strip()
    return cleaned or None


def _join_addresses(value: Any) -> str | None:
    """``meta.to`` is a list of addresses; ``meta.from`` a raw header. Both → str."""
    if value is None:
        return None
    if isinstance(value, (list, tuple)):
        parts = [str(v).strip() for v in value if str(v).strip()]
        return ", ".join(parts) or None
    text = str(value).strip()
    return text or None


def _lead_name(lead: Any) -> str | None:
    return " ".join(p for p in (lead.first_name, lead.last_name) if p) or None


def _preview(item: ThreadItem) -> str:
    """Single-line, quote-stripped, <=160-char summary of an item."""
    text = clean_reply_body(item.body) if item.body else ""
    text = " ".join(text.split())
    if not text:
        text = " ".join((item.subject or "").split())
    if len(text) > PREVIEW_MAX_CHARS:
        text = text[: PREVIEW_MAX_CHARS - 1].rstrip() + "…"
    return text


def _build_thread(
    msgs: list[Any],
    events: list[Any],
    our_from: str | None,
    lead_email: str | None,
) -> list[ThreadItem]:
    """Merge message rows + events into one chronological thread (oldest first).

    Pure function over already-fetched rows so both endpoints share the exact
    same merge/dedupe rules without touching the DB.
    """
    items: list[ThreadItem] = []
    seen_ids: set[str] = set()

    for m in msgs:
        if m.status not in CORRESPONDENCE_MESSAGE_STATUSES:
            continue
        mid = _norm_message_id(m.smtp_message_id)
        if mid:
            seen_ids.add(mid)
        items.append(
            ThreadItem(
                id=f"m:{m.id}",
                direction="outbound",
                source="board" if m.kind == "followup_reply" else "pipeline",
                sender=our_from,
                recipient=lead_email,
                subject=m.subject,
                body=m.body,
                kind=m.kind,
                timestamp=_as_utc(m.sent_at or m.created_at),
                status=m.status,
            )
        )

    for ev in events:
        if ev.type not in CORRESPONDENCE_EVENT_TYPES:
            continue
        meta = ev.meta if isinstance(ev.meta, dict) else {}
        imap_id = _norm_message_id(meta.get("imap_message_id"))
        if imap_id:
            if imap_id in seen_ids:
                continue
            seen_ids.add(imap_id)

        if ev.type == "replied":
            items.append(
                ThreadItem(
                    id=f"e:{ev.id}",
                    direction="inbound",
                    source="mailbox",
                    sender=_join_addresses(meta.get("from")) or lead_email,
                    recipient=our_from,
                    subject=_join_addresses(meta.get("subject")) or ev.detail,
                    body=clean_reply_body(meta.get("body")) or None,
                    kind="reply",
                    timestamp=_as_utc(ev.created_at),
                    status="replied",
                )
            )
        else:  # sent_manual
            body = meta.get("body")
            items.append(
                ThreadItem(
                    id=f"e:{ev.id}",
                    direction="outbound",
                    source="mailbox",
                    sender=_join_addresses(meta.get("from")) or our_from,
                    recipient=_join_addresses(meta.get("to")) or lead_email,
                    subject=_join_addresses(meta.get("subject")) or ev.detail,
                    body=body if isinstance(body, str) and body else None,
                    kind="manual",
                    timestamp=_parse_rfc2822(meta.get("date")) or _as_utc(ev.created_at),
                    status="sent",
                )
            )

    # Stable sort: ties keep insertion order (messages before events, id asc).
    items.sort(key=lambda it: it.timestamp or _EPOCH)
    return items


def _matches_query(lead: Any, q: str) -> bool:
    needle = q.lower()
    return any(
        needle in (value or "").lower()
        for value in (lead.email, lead.company, lead.first_name, lead.last_name)
    )


async def _from_by_domain() -> dict[int, str | None]:
    domains = await prisma.domains.find_many()
    return {d.id: (d.from_email or d.smtp_user) for d in domains}


# --------------------------------------------------------------------------- #
# Routes
# --------------------------------------------------------------------------- #
@router.get("", response_model=ConversationPage)
@router.get("/", response_model=ConversationPage, include_in_schema=False)
async def list_conversations(
    domain: str | None = Query(None, description="Domain slug or id; omit for all domains"),
    q: str | None = Query(None, description="Case-insensitive match on email / company / name"),
    limit: int = Query(50, ge=1, le=200),
    offset: int = Query(0, ge=0),
    _user=Depends(get_current_user),
) -> ConversationPage:
    """One row per lead with at least one real exchange, newest activity first.

    Two bulk queries (messages + events, each with the lead included), merged
    per lead in Python — the corpus is ~150 leads, so no per-row round trips.
    """
    where_msgs: dict[str, Any] = {"status": {"in": list(CORRESPONDENCE_MESSAGE_STATUSES)}}
    where_events: dict[str, Any] = {"type": {"in": list(CORRESPONDENCE_EVENT_TYPES)}}
    if domain is not None:
        domain_id = await _resolve_domain_id(domain)
        scope = {"is": {"domain_id": domain_id}}
        where_msgs["leads"] = scope
        where_events["leads"] = scope

    msg_rows = await prisma.messages.find_many(
        where=where_msgs, order={"id": "asc"}, include={"leads": True}
    )
    event_rows = await prisma.events.find_many(
        where=where_events, order={"id": "asc"}, include={"leads": True}
    )
    from_by_domain = await _from_by_domain()

    leads_by_id: dict[int, Any] = {}
    msgs_by_lead: dict[int, list[Any]] = {}
    events_by_lead: dict[int, list[Any]] = {}

    for m in msg_rows:
        lead = getattr(m, "leads", None)
        if lead is None:
            continue
        leads_by_id.setdefault(lead.id, lead)
        msgs_by_lead.setdefault(lead.id, []).append(m)

    for ev in event_rows:
        lead = getattr(ev, "leads", None)
        if lead is None:
            continue
        leads_by_id.setdefault(lead.id, lead)
        events_by_lead.setdefault(lead.id, []).append(ev)

    rows: list[Conversation] = []
    for lead_id, lead in leads_by_id.items():
        if q and not _matches_query(lead, q):
            continue
        thread = _build_thread(
            msgs_by_lead.get(lead_id, []),
            events_by_lead.get(lead_id, []),
            from_by_domain.get(lead.domain_id),
            lead.email,
        )
        if not thread:
            continue
        last = thread[-1]
        rows.append(
            Conversation(
                lead_id=lead_id,
                lead_email=lead.email,
                lead_name=_lead_name(lead),
                company=lead.company,
                domain_id=lead.domain_id,
                status=lead.status,
                replied_at=_as_utc(lead.replied_at),
                last_at=last.timestamp or _EPOCH,
                last_direction=last.direction,
                last_source=last.source,
                last_preview=_preview(last),
                counts=ConversationCounts(
                    inbound=sum(1 for it in thread if it.direction == "inbound"),
                    outbound=sum(1 for it in thread if it.direction == "outbound"),
                ),
            )
        )

    rows.sort(key=lambda r: r.last_at, reverse=True)
    total = len(rows)
    return ConversationPage(
        items=rows[offset : offset + limit], total=total, limit=limit, offset=offset
    )


@router.get("/{lead_id}", response_model=ConversationThread)
async def get_conversation(
    lead_id: int,
    _user=Depends(get_current_user),
) -> ConversationThread:
    """The full thread for one lead, oldest first. 404 when the lead is unknown."""
    lead = await prisma.leads.find_unique(where={"id": lead_id}, include={"domains": True})
    if lead is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Lead not found")

    dom = getattr(lead, "domains", None)
    our_from = (dom.from_email or dom.smtp_user) if dom is not None else None

    msgs = await prisma.messages.find_many(
        where={"lead_id": lead_id, "status": {"in": list(CORRESPONDENCE_MESSAGE_STATUSES)}},
        order={"id": "asc"},
    )
    events = await prisma.events.find_many(
        where={"lead_id": lead_id, "type": {"in": list(CORRESPONDENCE_EVENT_TYPES)}},
        order={"id": "asc"},
    )

    return ConversationThread(
        lead=ConversationLead(
            id=lead.id,
            email=lead.email,
            first_name=lead.first_name,
            last_name=lead.last_name,
            company=lead.company,
            domain_id=lead.domain_id,
            status=lead.status,
            pain_point=lead.pain_point,
            replied_at=_as_utc(lead.replied_at),
        ),
        items=_build_thread(msgs, events, our_from, lead.email),
    )
