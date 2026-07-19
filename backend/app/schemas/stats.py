"""Dashboard aggregate stats."""
from __future__ import annotations

from pydantic import BaseModel


class DomainStat(BaseModel):
    slug: str
    name: str
    is_active: bool
    total_leads: int
    contacted: int
    replied: int
    bounced: int
    reply_rate: float


class Overview(BaseModel):
    domains: int
    active_domains: int
    total_leads: int
    total_contacted: int
    total_replied: int
    total_bounced: int
    messages_sent: int
    runs_recent: int
    reply_rate: float
    per_domain: list[DomainStat]
    status_breakdown: dict
