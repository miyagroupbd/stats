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
    """Every reply we have received — REPLIED events joined with lead + our email.

    Reply text lives in event.meta (written by pipeline A7). Old events recorded
    before body capture show without a body until a backfill run fills them.
    """
    where: dict[str, Any] = {"type": "replied"}
    if domain is not None:
        domain_id = await _resolve_domain_id(domain)
        where["leads"] = {"is": {"domain_id": domain_id}}

    total = await prisma.events.count(where=where)
    rows = await prisma.events.find_many(
        where=where,
        order={"id": "desc"},
        take=limit,
        skip=offset,
        include={"leads": True, "messages": True},
    )

    domains = await prisma.domains.find_many()
    from_by_domain = {d.id: (d.from_email or d.smtp_user) for d in domains}

    items: list[ReplyOut] = []
    for ev in rows:
        meta = ev.meta if isinstance(ev.meta, dict) else {}
        lead = getattr(ev, "leads", None)
        msg = getattr(ev, "messages", None)
        name = None
        if lead is not None:
            name = " ".join(p for p in (lead.first_name, lead.last_name) if p) or None
        items.append(ReplyOut(
            id=ev.id,
            lead_id=ev.lead_id,
            message_id=ev.message_id,
            domain_id=lead.domain_id if lead else None,
            lead_email=lead.email if lead else None,
            lead_name=name,
            company=lead.company if lead else None,
            pain_point=lead.pain_point if lead else None,
            reply_from=meta.get("from"),
            reply_subject=meta.get("subject") or ev.detail,
            reply_body=meta.get("body"),
            reply_date=meta.get("date"),
            received_at=ev.created_at,
            our_kind=msg.kind if msg else None,
            our_subject=msg.subject if msg else None,
            our_body=msg.body if msg else None,
            our_sent_at=msg.sent_at if msg else None,
            our_from=from_by_domain.get(lead.domain_id) if lead else None,
        ))

    return ReplyPage(items=items, total=total, limit=limit, offset=offset)


@router.post("/replies/backfill")
async def backfill_replies(
    _user=Depends(require_admin),
    domain: str | None = Body(None, embed=True),
) -> dict:
    """Recover old reply bodies: queue a monitor run with stage='backfill'.

    A7 then rescans the ENTIRE inbox (seen mail included), attaches bodies to
    replies recorded before capture existed, and records any that were missed.
    One run per active arm, or just the given arm.
    """
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
    return {"queued": run_ids}


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
