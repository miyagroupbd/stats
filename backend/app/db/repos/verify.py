"""Verification asset repository — email_cache + domain_intel.

This is the accumulating dataset that reduces dependence on paid providers:
every verify result is cached, and per-company email patterns are learned.
"""
from __future__ import annotations

from datetime import datetime, timezone

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.db.enums import VerifyStatus
from app.db.models import DomainIntel, EmailCache


def get_cached(session: Session, email: str) -> EmailCache | None:
    return session.scalar(select(EmailCache).where(EmailCache.email == email))


def put_cached(
    session: Session,
    *,
    email: str,
    verify_status: VerifyStatus,
    confidence: int | None = None,
    provider: str | None = None,
    is_catch_all: bool | None = None,
    raw: dict | None = None,
) -> EmailCache:
    row = get_cached(session, email)
    created = row is None
    if created:
        row = EmailCache(email=email)
        session.add(row)
    row.verify_status = verify_status
    row.confidence = confidence
    row.provider = provider
    row.is_catch_all = is_catch_all
    row.raw = raw
    row.checked_at = datetime.now(timezone.utc)
    if created:
        session.flush()  # fields set → safe to flush so a later get_cached() sees it
    return row


def get_intel(session: Session, company_domain: str) -> DomainIntel | None:
    return session.scalar(select(DomainIntel).where(DomainIntel.company_domain == company_domain))


def upsert_intel(
    session: Session,
    *,
    company_domain: str,
    mx_provider: str | None = None,
    is_catch_all: bool | None = None,
    email_pattern: str | None = None,
    pattern_confidence: float | None = None,
    increment_verified: int = 0,
) -> DomainIntel:
    row = get_intel(session, company_domain)
    if row is None:
        row = DomainIntel(company_domain=company_domain)
        session.add(row)
        session.flush()  # so a later get_intel() in this same session sees it
    if mx_provider is not None:
        row.mx_provider = mx_provider
    if is_catch_all is not None:
        row.is_catch_all = is_catch_all
    if email_pattern is not None:
        row.email_pattern = email_pattern
    if pattern_confidence is not None:
        row.pattern_confidence = pattern_confidence
    if increment_verified:
        row.verified_count = (row.verified_count or 0) + increment_verified
    return row
