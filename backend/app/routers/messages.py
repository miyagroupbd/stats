"""Messages router — read-only listing of drafted/sent emails for the dashboard.

Every email the pipeline drafts or sends is a Message row (belonging to a Lead,
which belongs to a Domain). These endpoints let the dashboard page through a
domain's messages, filtered by delivery status and follow-up kind, and fetch a
single message by id. Read-only: no admin gate beyond authentication.
"""
from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.deps import get_current_user, get_db
from app.schemas.common import Page
from app.schemas.message import MessageOut
from app.db.enums import MessageKind, MessageStatus
from app.db.models import Domain, Lead, Message
from app.db.repos import domains as domains_repo

router = APIRouter(prefix="/messages", tags=["messages"])


class MessagePage(Page):
    """Paginated Message envelope (extends the shared Page primitive)."""
    items: list[MessageOut]


def _resolve_domain(db: Session, domain: str) -> Domain:
    """Resolve a ?domain= that is a slug OR a numeric id; 404 if missing."""
    dom = domains_repo.get_by_slug(db, domain)
    if dom is None and domain.isdigit():
        dom = domains_repo.get(db, int(domain))
    if dom is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Domain not found")
    return dom


@router.get("/", response_model=MessagePage)
def list_messages(
    domain: str = Query(..., description="Domain slug or numeric id"),
    status_: str | None = Query(None, alias="status", description="MessageStatus filter"),
    kind: str | None = Query(None, description="MessageKind filter"),
    limit: int = Query(50, ge=1, le=500),
    offset: int = Query(0, ge=0),
    db: Session = Depends(get_db),
    _user=Depends(get_current_user),
) -> MessagePage:
    dom = _resolve_domain(db, domain)

    filters = [Lead.domain_id == dom.id]

    if status_ is not None:
        try:
            filters.append(Message.status == MessageStatus(status_))
        except ValueError:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"Invalid status '{status_}'",
            )

    if kind is not None:
        try:
            filters.append(Message.kind == MessageKind(kind))
        except ValueError:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"Invalid kind '{kind}'",
            )

    total = db.scalar(
        select(func.count()).select_from(Message).join(Lead, Message.lead_id == Lead.id).where(*filters)
    ) or 0

    rows = db.scalars(
        select(Message)
        .join(Lead, Message.lead_id == Lead.id)
        .where(*filters)
        .order_by(Message.id.desc())
        .limit(limit)
        .offset(offset)
    ).all()

    return MessagePage(
        items=[MessageOut.model_validate(m) for m in rows],
        total=total,
        limit=limit,
        offset=offset,
    )


@router.get("/{message_id}", response_model=MessageOut)
def get_message(
    message_id: int,
    db: Session = Depends(get_db),
    _user=Depends(get_current_user),
) -> MessageOut:
    msg = db.get(Message, message_id)
    if msg is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Message not found")
    return MessageOut.model_validate(msg)
