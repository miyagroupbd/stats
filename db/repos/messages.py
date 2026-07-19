"""Message repository — drafted/sent emails and reply-threading lookups."""
from __future__ import annotations

from datetime import datetime, timezone

from sqlalchemy import select
from sqlalchemy.orm import Session

from db.enums import MessageKind, MessageStatus
from db.models import Message


def create(
    session: Session,
    *,
    lead_id: int,
    campaign_id: int | None = None,
    kind: MessageKind = MessageKind.INITIAL,
    subject: str | None = None,
    subject_b: str | None = None,
    body: str | None = None,
    status: MessageStatus = MessageStatus.DRAFTED,
) -> Message:
    msg = Message(
        lead_id=lead_id,
        campaign_id=campaign_id,
        kind=kind,
        subject=subject,
        subject_b=subject_b,
        body=body,
        status=status,
    )
    session.add(msg)
    return msg


def mark_sent(session: Session, msg: Message, smtp_message_id: str | None) -> None:
    msg.status = MessageStatus.SENT
    msg.smtp_message_id = smtp_message_id
    msg.sent_at = datetime.now(timezone.utc)


def mark_failed(session: Session, msg: Message, error: str) -> None:
    msg.status = MessageStatus.FAILED
    msg.error = error


def find_by_smtp_id(session: Session, smtp_message_id: str) -> Message | None:
    """Reply/bounce threading: match an inbound In-Reply-To/References header."""
    if not smtp_message_id:
        return None
    return session.scalar(
        select(Message).where(Message.smtp_message_id == smtp_message_id)
    )


def latest_for_lead(session: Session, lead_id: int) -> Message | None:
    return session.scalar(
        select(Message).where(Message.lead_id == lead_id).order_by(Message.id.desc()).limit(1)
    )


def pending_send(session: Session, domain_id: int, limit: int = 50) -> list[Message]:
    """DRAFTED messages whose lead belongs to this domain — A5's send queue."""
    from db.models import Lead  # local import avoids a circular import at module load

    stmt = (
        select(Message)
        .join(Lead, Message.lead_id == Lead.id)
        .where(Lead.domain_id == domain_id, Message.status == MessageStatus.DRAFTED)
        .order_by(Message.id.asc())
        .limit(limit)
    )
    return list(session.scalars(stmt))
