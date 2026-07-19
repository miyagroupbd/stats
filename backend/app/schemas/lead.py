"""Lead schemas."""
from __future__ import annotations

from datetime import datetime

from pydantic import BaseModel, ConfigDict


class LeadBase(BaseModel):
    email: str
    first_name: str | None = None
    last_name: str | None = None
    title: str | None = None
    linkedin_url: str | None = None
    phone: str | None = None
    company: str | None = None
    company_domain: str | None = None
    industry: str | None = None
    country: str | None = None
    employee_count: int | None = None


class LeadCreate(LeadBase):
    campaign_id: int | None = None
    source: str = "manual"


class LeadUpdate(BaseModel):
    first_name: str | None = None
    last_name: str | None = None
    title: str | None = None
    company: str | None = None
    industry: str | None = None
    country: str | None = None
    employee_count: int | None = None
    status: str | None = None
    segment: str | None = None
    notes: str | None = None
    campaign_id: int | None = None


class LeadOut(LeadBase):
    model_config = ConfigDict(from_attributes=True)
    id: int
    domain_id: int
    campaign_id: int | None = None
    status: str
    segment: str | None = None
    priority: str | None = None
    score: int | None = None
    source: str
    verify_status: str
    verify_confidence: int | None = None
    pain_point: str | None = None
    hook: str | None = None
    notes: str | None = None
    follow_up_count: int
    last_contacted_at: datetime | None = None
    replied_at: datetime | None = None
    created_at: datetime
    updated_at: datetime


class LeadImportResult(BaseModel):
    created: int
    updated: int
    skipped: int
    errors: list[str] = []
