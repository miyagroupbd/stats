"""Lead repository — replaces the Google-Sheets read/write surface.

The engine no longer addresses rows by position; every operation is by lead id
or (domain_id, email), which kills the concurrent-edit corruption class.
"""
from __future__ import annotations

from datetime import datetime, timezone

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.db.enums import LeadStatus, Priority, VerifyStatus
from app.db.models import Lead

# Terminal-ish statuses that mean "already contacted / do not re-send".
CONTACTED_STATUSES = {
    LeadStatus.CONTACTED,
    LeadStatus.REPLIED,
    LeadStatus.BOUNCED,
    LeadStatus.CONVERTED,
    LeadStatus.DEAD,
    LeadStatus.SUPPRESSED,
}


def get(session: Session, lead_id: int) -> Lead | None:
    return session.get(Lead, lead_id)


def get_by_email(session: Session, domain_id: int, email: str) -> Lead | None:
    return session.scalar(
        select(Lead).where(Lead.domain_id == domain_id, Lead.email == email)
    )


def list_all(session: Session, domain_id: int) -> list[Lead]:
    return list(session.scalars(select(Lead).where(Lead.domain_id == domain_id)))


def pending(session: Session, domain_id: int, limit: int = 20) -> list[Lead]:
    """Leads ready for first-touch: qualified/queued/new with an email, top score first."""
    stmt = (
        select(Lead)
        .where(
            Lead.domain_id == domain_id,
            Lead.status.in_([LeadStatus.NEW, LeadStatus.QUALIFIED, LeadStatus.QUEUED]),
            Lead.email != "",
            Lead.email.is_not(None),
        )
        .order_by(Lead.score.desc().nullslast(), Lead.id.asc())
        .limit(limit)
    )
    return list(session.scalars(stmt))


def by_status(session: Session, domain_id: int, status: LeadStatus) -> list[Lead]:
    return list(session.scalars(select(Lead).where(Lead.domain_id == domain_id, Lead.status == status)))


def contacted_emails(session: Session, domain_id: int) -> set[str]:
    stmt = select(Lead.email).where(
        Lead.domain_id == domain_id, Lead.status.in_(CONTACTED_STATUSES)
    )
    return {e for e in session.scalars(stmt) if e}


def upsert(session: Session, domain_id: int, email: str, **fields) -> tuple[Lead, bool]:
    """Insert a lead or update the existing (domain_id, email). Returns (lead, created).

    Does NOT commit — caller controls the transaction. On update, only provided
    fields overwrite; pipeline-state fields are left untouched unless passed.
    """
    lead = get_by_email(session, domain_id, email)
    created = lead is None
    if created:
        lead = Lead(domain_id=domain_id, email=email)
        session.add(lead)
        session.flush()  # so a repeat upsert of the same email in this session sees it
    for key, value in fields.items():
        if hasattr(lead, key) and value is not None:
            setattr(lead, key, value)
    return lead, created


def mark_contacted(session: Session, lead: Lead, *, message_id: str | None = None) -> None:
    lead.status = LeadStatus.CONTACTED
    lead.last_contacted_at = datetime.now(timezone.utc)


def mark_replied(session: Session, lead: Lead) -> None:
    lead.status = LeadStatus.REPLIED
    lead.replied_at = datetime.now(timezone.utc)


def mark_bounced(session: Session, lead: Lead) -> None:
    lead.status = LeadStatus.BOUNCED


def set_verification(session: Session, lead: Lead, status: VerifyStatus, confidence: int | None) -> None:
    lead.verify_status = status
    lead.verify_confidence = confidence


def unverified(session: Session, domain_id: int, limit: int = 25) -> list[Lead]:
    """Leads with an email that our verifier hasn't checked yet (e.g. CSV imports)."""
    stmt = (
        select(Lead)
        .where(
            Lead.domain_id == domain_id,
            Lead.verify_status == VerifyStatus.UNVERIFIED,
            Lead.email.is_not(None),
            Lead.email != "",
        )
        .order_by(Lead.id.asc())
        .limit(limit)
    )
    return list(session.scalars(stmt))


def needing_analysis(session: Session, domain_id: int, limit: int = 50) -> list[Lead]:
    """Qualified leads that A3 has not analysed yet (no pain_point)."""
    stmt = (
        select(Lead)
        .where(
            Lead.domain_id == domain_id,
            Lead.status == LeadStatus.QUALIFIED,
            Lead.pain_point.is_(None),
        )
        .order_by(Lead.score.desc().nullslast())
        .limit(limit)
    )
    return list(session.scalars(stmt))


def needing_copy(session: Session, domain_id: int, limit: int = 50) -> list[Lead]:
    """Qualified, analysed leads ready for A4 to draft an initial email."""
    stmt = (
        select(Lead)
        .where(
            Lead.domain_id == domain_id,
            Lead.status == LeadStatus.QUALIFIED,
            Lead.pain_point.is_not(None),
        )
        .order_by(Lead.score.desc().nullslast())
        .limit(limit)
    )
    return list(session.scalars(stmt))


def followup_candidates(
    session: Session, domain_id: int, *, cutoff: datetime, max_follow_ups: int, limit: int = 50
) -> list[Lead]:
    """Contacted leads with no reply, past the follow-up cutoff, under the cap."""
    stmt = (
        select(Lead)
        .where(
            Lead.domain_id == domain_id,
            Lead.status == LeadStatus.CONTACTED,
            Lead.replied_at.is_(None),
            Lead.follow_up_count < max_follow_ups,
            Lead.last_contacted_at.is_not(None),
            Lead.last_contacted_at <= cutoff,
        )
        .limit(limit)
    )
    return list(session.scalars(stmt))


def counts_by_status(session: Session, domain_id: int) -> dict[str, int]:
    stmt = (
        select(Lead.status, func.count())
        .where(Lead.domain_id == domain_id)
        .group_by(Lead.status)
    )
    return {status.value if hasattr(status, "value") else str(status): n for status, n in session.execute(stmt)}
