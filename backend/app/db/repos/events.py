"""Event repository — delivery / bounce / reply / unsubscribe records."""
from __future__ import annotations

from sqlalchemy.orm import Session

from app.db.enums import EventType
from app.db.models import Event


def add(
    session: Session,
    *,
    lead_id: int,
    type: EventType,
    message_id: int | None = None,
    detail: str | None = None,
    meta: dict | None = None,
) -> Event:
    event = Event(
        lead_id=lead_id,
        message_id=message_id,
        type=type,
        detail=detail,
        meta=meta,
    )
    session.add(event)
    return event
