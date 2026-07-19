"""User repository — dashboard auth lookups."""
from __future__ import annotations

from datetime import datetime, timezone

from sqlalchemy import select
from sqlalchemy.orm import Session

from db.models import User


def get_by_email(session: Session, email: str) -> User | None:
    return session.scalar(select(User).where(User.email == email))


def get(session: Session, user_id: int) -> User | None:
    return session.get(User, user_id)


def touch_login(session: Session, user: User) -> None:
    user.last_login_at = datetime.now(timezone.utc)
