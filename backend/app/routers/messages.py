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
from app.schemas.message import MessageOut
from app.services import runner

router = APIRouter(prefix="/messages", tags=["messages"])

MESSAGE_STATUSES = {"drafted", "approved", "rejected", "queued", "sent", "failed"}
MESSAGE_KINDS = {"initial", "followup_1", "followup_2", "followup_3"}


class MessagePage(Page):
    """Paginated Message envelope (extends the shared Page primitive)."""
    items: list[MessageOut]


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
        items.append(out)

    return MessagePage(items=items, total=total, limit=limit, offset=offset)


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
