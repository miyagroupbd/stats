"""Suppression (do-not-contact) repository. Checked before every send."""
from __future__ import annotations

from sqlalchemy import or_, select
from sqlalchemy.orm import Session

from db.enums import SuppressionReason
from db.models import Suppression


def is_suppressed(session: Session, email: str, domain_id: int | None = None) -> bool:
    """True if the email is globally suppressed (domain_id NULL) or for this domain."""
    stmt = select(Suppression.id).where(
        Suppression.email == email,
        or_(Suppression.domain_id.is_(None), Suppression.domain_id == domain_id),
    )
    return session.scalar(stmt) is not None


def suppressed_set(session: Session, domain_id: int | None = None) -> set[str]:
    stmt = select(Suppression.email).where(
        or_(Suppression.domain_id.is_(None), Suppression.domain_id == domain_id)
    )
    return set(session.scalars(stmt))


def add(
    session: Session,
    email: str,
    *,
    domain_id: int | None = None,
    reason: SuppressionReason = SuppressionReason.MANUAL,
    detail: str | None = None,
) -> Suppression:
    """Add a suppression entry (idempotent on (domain_id, email))."""
    existing = session.scalar(
        select(Suppression).where(
            Suppression.email == email, Suppression.domain_id == domain_id
        )
    )
    if existing:
        return existing
    entry = Suppression(email=email, domain_id=domain_id, reason=reason, detail=detail)
    session.add(entry)
    session.flush()  # so a repeat add of the same email in this session is deduped
    return entry
