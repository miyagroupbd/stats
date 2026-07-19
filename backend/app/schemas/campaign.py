"""Campaign schemas."""
from __future__ import annotations

from datetime import datetime

from pydantic import BaseModel, ConfigDict


class CampaignCreate(BaseModel):
    name: str
    description: str | None = None


class CampaignUpdate(BaseModel):
    name: str | None = None
    description: str | None = None
    status: str | None = None


class CampaignOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    domain_id: int
    name: str
    description: str | None = None
    status: str
    created_at: datetime
    updated_at: datetime
    lead_count: int | None = None
