"""Messages router — read-only listing of drafted/sent emails for the dashboard.

Every email the pipeline drafts or sends is a Message row (belonging to a Lead,
which belongs to a Domain). These endpoints let the dashboard page through a
domain's messages, filtered by delivery status and follow-up kind, and fetch a
single message by id. Read-only: no admin gate beyond authentication.
"""
from __future__ import annotations

from datetime import datetime, timezone
from typing import Any

from fastapi import APIRouter, Body, Depends, HTTPException, Query, status

from app.core.db import prisma
from app.deps import get_current_user, require_admin
from app.schemas.common import Page
from app.schemas.message import MessageEdit, MessageOut, ReplyOut
from app.services import runner

router = APIRouter(prefix="/messages", tags=["messages"])

MESSAGE_STATUSES = {"drafted", "approved", "rejected", "queued", "sent", "failed"}
MESSAGE_KINDS = {"initial", "followup_1", "followup_2", "followup_3"}


class MessagePage(Page):
    """Paginated Message envelope (extends the shared Page primitive)."""
    items: list[MessageOut]


class ReplyPage(Page):
    """Paginated received-replies envelope."""
    items: list[ReplyOut]


async def _resolve_domain_id(domain: str) -> int:
    """Resolve a ?domain= that is a slug OR a numeric id; 404 if missing."""
    dom = await prisma.domains.find_unique(where={"slug": domain})
    if dom is None and domain.isdigit():
        dom = await prisma.domains.find_unique(where={"id": int(domain)})
    if dom is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Domain not found")
    return dom.id


@router.get("/", response_model=MessagePage)
async def list_messages(
    domain: str | None = Query(None, description="Domain slug or id; omit for all domains"),
    status_: str | None = Query(None, alias="status", description="MessageStatus filter"),
    kind: str | None = Query(None, description="MessageKind filter"),
    limit: int = Query(50, ge=1, le=500),
    offset: int = Query(0, ge=0),
    _user=Depends(get_current_user),
) -> MessagePage:
    # No ?domain= means every arm — so drafts awaiting approval are visible even
    # when the first-listed arm has none (the page used to open on an empty arm).
    where: dict[str, Any] = {}
    if domain is not None:
        domain_id = await _resolve_domain_id(domain)
        where["leads"] = {"is": {"domain_id": domain_id}}

    if status_ is not None:
        if status_ not in MESSAGE_STATUSES:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"Invalid status '{status_}'",
            )
        where["status"] = status_

    if kind is not None:
        if kind not in MESSAGE_KINDS:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"Invalid kind '{kind}'",
            )
        where["kind"] = kind

    total = await prisma.messages.count(where=where)

    rows = await prisma.messages.find_many(
        where=where,
        order={"id": "desc"},
        take=limit,
        skip=offset,
        include={"leads": True},
    )

    # "Sent from" = the sending address of the arm each message belongs to
    # (message -> lead -> domain.from_email).
    domains = await prisma.domains.find_many()
    from_by_domain = {d.id: (d.from_email or d.smtp_user) for d in domains}

    items = []
    for m in rows:
        out = MessageOut.model_validate(m)
        lead = getattr(m, "leads", None)
        if lead is not None:
            out.from_email = from_by_domain.get(lead.domain_id)
            out.to_email = lead.email
            # Bounce is lead-level (A8 marks the lead BOUNCED on an NDR), so a
            # message "bounced" iff its recipient lead is now in that state.
            out.bounced = lead.status == "bounced"
        items.append(out)

    return MessagePage(items=items, total=total, limit=limit, offset=offset)


# NOTE: /replies must be declared BEFORE /{message_id} — the int path converter
# would otherwise swallow the literal segment and 422.
@router.get("/replies", response_model=ReplyPage)
async def list_replies(
    domain: str | None = Query(None, description="Domain slug or id; omit for all domains"),
    limit: int = Query(50, ge=1, le=500),
    offset: int = Query(0, ge=0),
    _user=Depends(get_current_user),
) -> ReplyPage:
    """Every reply we have received — REPLIED events + replied leads joined with email.

    Reply text lives in event.meta (written by pipeline A7). Old events recorded
    before body capture show fallback text or lead notes until a backfill run fills them.
    """
    where_events: dict[str, Any] = {"type": "replied"}
    where_leads: dict[str, Any] = {"OR": [{"status": "replied"}, {"replied_at": {"not": None}}]}
    if domain is not None:
        domain_id = await _resolve_domain_id(domain)
        where_events["leads"] = {"is": {"domain_id": domain_id}}
        where_leads["domain_id"] = domain_id

    # Fetch ALL matching events
    rows = await prisma.events.find_many(
        where=where_events,
        order={"id": "desc"},
        include={"leads": True, "messages": True},
    )

    domains = await prisma.domains.find_many()
    from_by_domain = {d.id: (d.from_email or d.smtp_user) for d in domains}

    # Deduplicate strictly by lead_id so each lead's reply appears EXACTLY ONCE
    by_lead: dict[int, ReplyOut] = {}

    for ev in rows:
        lead = getattr(ev, "leads", None)
        if lead is None or not ev.lead_id:
            continue

        lead_id = ev.lead_id
        msg = getattr(ev, "messages", None)
        if msg is None and getattr(lead, "messages", None):
            msg = lead.messages[0]

        meta = ev.meta if isinstance(ev.meta, dict) else {}
        name = " ".join(p for p in (lead.first_name, lead.last_name) if p) or None

        reply_from = meta.get("from") or lead.email
        reply_subject = meta.get("subject") or ev.detail or "Re: Outreach"
        reply_body = (
            meta.get("body")
            or meta.get("text")
            or meta.get("content")
            or meta.get("snippet")
            or meta.get("notes")
            or (ev.detail if ev.detail and ev.detail != (meta.get("subject") or "") else None)
            or (lead.notes if lead and lead.notes else None)
        )

        candidate = ReplyOut(
            id=ev.id,
            lead_id=lead_id,
            message_id=ev.message_id or (msg.id if msg else None),
            domain_id=lead.domain_id,
            lead_email=lead.email,
            lead_name=name,
            company=lead.company,
            pain_point=lead.pain_point,
            reply_from=reply_from,
            reply_subject=reply_subject,
            reply_body=reply_body,
            reply_date=meta.get("date"),
            received_at=ev.created_at,
            our_kind=msg.kind if msg else None,
            our_subject=msg.subject if msg else None,
            our_body=msg.body if msg else None,
            our_sent_at=msg.sent_at if msg else None,
            our_from=from_by_domain.get(lead.domain_id),
        )

        existing = by_lead.get(lead_id)
        if existing is None:
            by_lead[lead_id] = candidate
        else:
            # Upgrade existing if candidate has body and existing does not
            cand_has_body = bool(candidate.reply_body and not candidate.reply_body.startswith("body not captured"))
            exist_has_body = bool(existing.reply_body and not existing.reply_body.startswith("body not captured"))
            if cand_has_body and not exist_has_body:
                by_lead[lead_id] = candidate
            elif candidate.received_at > existing.received_at and (cand_has_body == exist_has_body):
                by_lead[lead_id] = candidate

    # Also query leads marked as replied to capture old/manual replies without event rows
    replied_leads = await prisma.leads.find_many(
        where=where_leads,
        include={"messages": True},
    )

    # Add synthetic replies for leads that have status='replied' but no events
    for lead in replied_leads:
        if lead.id not in by_lead:
            name = " ".join(p for p in (lead.first_name, lead.last_name) if p) or None
            msg = lead.messages[0] if getattr(lead, "messages", None) else None
            by_lead[lead.id] = ReplyOut(
                id=-lead.id,
                lead_id=lead.id,
                message_id=msg.id if msg else None,
                domain_id=lead.domain_id,
                lead_email=lead.email,
                lead_name=name,
                company=lead.company,
                pain_point=lead.pain_point,
                reply_from=lead.email,
                reply_subject="Re: " + (msg.subject if msg and msg.subject else "Outreach"),
                reply_body=lead.notes or f"Reply recorded for lead {lead.email}",
                reply_date=None,
                received_at=lead.replied_at or lead.updated_at or datetime.now(timezone.utc),
                our_kind=msg.kind if msg else None,
                our_subject=msg.subject if msg else None,
                our_body=msg.body if msg else None,
                our_sent_at=msg.sent_at if msg else None,
                our_from=from_by_domain.get(lead.domain_id),
            )

    items: list[ReplyOut] = sorted(by_lead.values(), key=lambda x: x.received_at, reverse=True)
    total = len(items)
    page_items = items[offset:offset + limit]

    return ReplyPage(items=page_items, total=total, limit=limit, offset=offset)


@router.post("/replies/backfill")
async def backfill_replies(
    _user=Depends(get_current_user),
    domain: str | None = Body(None, embed=True),
) -> dict:
    """Recover old reply bodies: backfill database metadata and queue monitor IMAP rescan."""
    # 1. Database-level backfill: populate event.meta['body'] from lead.notes if missing
    replied_events = await prisma.events.find_many(where={"type": "replied"}, include={"leads": True})
    db_backfilled = 0
    for ev in replied_events:
        meta = ev.meta if isinstance(ev.meta, dict) else {}
        if not meta.get("body"):
            lead = getattr(ev, "leads", None)
            fallback_body = (
                meta.get("snippet")
                or meta.get("text")
                or (ev.detail if ev.detail and ev.detail != meta.get("subject") else None)
                or (lead.notes if lead and lead.notes else None)
            )
            if fallback_body:
                new_meta = dict(meta)
                new_meta["body"] = fallback_body
                await prisma.events.update(
                    where={"id": ev.id},
                    data={"meta": new_meta},
                )
                db_backfilled += 1

    # 2. IMAP runner backfill: queue monitor run with stage='backfill'
    if domain is not None:
        dom = await prisma.domains.find_unique(where={"slug": domain})
        if dom is None:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Domain not found")
        slugs = [dom.slug]
    else:
        slugs = [d.slug for d in await prisma.domains.find_many(where={"is_active": True})]

    run_ids: dict[str, int] = {}
    for slug in slugs:
        run_ids[slug] = await runner.start_run(domain_slug=slug, mode="monitor", stage="backfill")

    return {"queued": run_ids, "db_backfilled": db_backfilled}


@router.get("/{message_id}", response_model=MessageOut)
async def get_message(
    message_id: int,
    _user=Depends(get_current_user),
) -> MessageOut:
    msg = await prisma.messages.find_unique(where={"id": message_id})
    if msg is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Message not found")
    return MessageOut.model_validate(msg)


# --------------------------------------------------------------------------- #
# Human approval gate — the connector between the board and the sender.
#
# The pipeline only DRAFTS; A5 sends nothing until a message is `approved`.
# These admin-gated actions are the ONLY way a draft becomes sendable. Sending
# still happens in the pipeline worker (which owns suppression/window/limits)
# and physically goes out through N8N — the board never sends directly.
# --------------------------------------------------------------------------- #
async def _get_message_or_404(message_id: int):
    msg = await prisma.messages.find_unique(where={"id": message_id})
    if msg is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Message not found")
    return msg


async def _domain_slug_for_message(msg) -> str:
    lead = await prisma.leads.find_unique(where={"id": msg.lead_id})
    if lead is None:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Message has no lead")
    dom = await prisma.domains.find_unique(where={"id": lead.domain_id})
    if dom is None:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Lead has no domain")
    return dom.slug


@router.patch("/{message_id}", response_model=MessageOut)
async def edit_message(
    message_id: int,
    edit: MessageEdit,
    user=Depends(require_admin),
) -> MessageOut:
    """Edit a draft's subject/body before it goes out.

    Editable while drafted/approved/rejected/failed — never once queued or sent.
    Editing an APPROVED message resets it to DRAFTED: what a human approved must
    be exactly what is sent, so any change re-enters the approval gate.
    """
    msg = await _get_message_or_404(message_id)
    if msg.status in {"queued", "sent"}:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Cannot edit a '{msg.status}' message",
        )

    data: dict[str, Any] = {}
    if edit.subject is not None:
        if not edit.subject.strip():
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Subject cannot be empty")
        data["subject"] = edit.subject.strip()
    if edit.subject_b is not None:
        data["subject_b"] = edit.subject_b.strip() or None
    if edit.body is not None:
        if not edit.body.strip():
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Body cannot be empty")
        data["body"] = edit.body.strip()
    if not data:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Nothing to update")

    # Any edit re-enters the approval gate.
    data.update({"status": "drafted", "approved_at": None, "approved_by": None,
                 "error": f"edited by {user.email}" if msg.status == "approved" else msg.error})
    updated = await prisma.messages.update(where={"id": message_id}, data=data)
    return MessageOut.model_validate(updated)


@router.post("/{message_id}/approve", response_model=MessageOut)
async def approve_message(message_id: int, user=Depends(require_admin)) -> MessageOut:
    """Clear a draft to send. Does not send — A5 sends approved messages."""
    msg = await _get_message_or_404(message_id)
    if msg.status not in {"drafted", "rejected", "failed"}:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Cannot approve a '{msg.status}' message",
        )
    updated = await prisma.messages.update(
        where={"id": message_id},
        data={
            "status": "approved",
            "approved_at": datetime.now(timezone.utc),
            "approved_by": user.email,
            "error": None,
        },
    )
    return MessageOut.model_validate(updated)


@router.post("/{message_id}/reject", response_model=MessageOut)
async def reject_message(
    message_id: int,
    user=Depends(require_admin),
    reason: str | None = Body(None, embed=True),
) -> MessageOut:
    """Decline a draft — it is never sent."""
    msg = await _get_message_or_404(message_id)
    if msg.status == "sent":
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST, detail="Cannot reject a sent message"
        )
    updated = await prisma.messages.update(
        where={"id": message_id},
        data={"status": "rejected", "error": reason or f"rejected by {user.email}"},
    )
    return MessageOut.model_validate(updated)


@router.post("/{message_id}/send")
async def send_message(message_id: int, user=Depends(require_admin)) -> dict:
    """Individual send: approve this message (if needed) and dispatch it now.

    Enqueues a `send` run targeting THIS message; the pipeline worker's A5
    sends only it, via N8N, honouring suppression/verify gates. Returns the
    send run id so the caller can follow it on the board.
    """
    msg = await _get_message_or_404(message_id)
    if msg.status == "sent":
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Already sent")

    data: dict[str, Any] = {"status": "approved", "error": None}
    if msg.status != "approved":
        data["approved_at"] = datetime.now(timezone.utc)
        data["approved_by"] = user.email
    await prisma.messages.update(where={"id": message_id}, data=data)

    slug = await _domain_slug_for_message(msg)
    run_id = await runner.start_run(domain_slug=slug, mode="send", stage=str(message_id))
    return {"message_id": message_id, "status": "approved", "send_run_id": run_id}
