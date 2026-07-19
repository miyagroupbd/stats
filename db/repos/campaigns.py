"""Campaign repository."""
from __future__ import annotations

from sqlalchemy import select
from sqlalchemy.orm import Session

from db.enums import CampaignStatus
from db.models import Campaign


def get(session: Session, campaign_id: int) -> Campaign | None:
    return session.get(Campaign, campaign_id)


def list_for_domain(session: Session, domain_id: int) -> list[Campaign]:
    return list(session.scalars(select(Campaign).where(Campaign.domain_id == domain_id)))


def get_or_create_default(session: Session, domain_id: int) -> Campaign:
    """Every domain has an always-on default campaign for ad-hoc sends."""
    existing = session.scalar(
        select(Campaign).where(Campaign.domain_id == domain_id, Campaign.name == "Default")
    )
    if existing:
        return existing
    campaign = Campaign(domain_id=domain_id, name="Default", status=CampaignStatus.ACTIVE)
    session.add(campaign)
    session.flush()  # so a repeat call in this same session reuses it
    return campaign


def create(session: Session, *, domain_id: int, name: str, description: str | None = None) -> Campaign:
    campaign = Campaign(domain_id=domain_id, name=name, description=description)
    session.add(campaign)
    return campaign
