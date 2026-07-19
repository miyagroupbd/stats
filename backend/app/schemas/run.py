"""Run + log schemas."""
from __future__ import annotations

from datetime import datetime

from pydantic import BaseModel, ConfigDict


class RunTrigger(BaseModel):
    domain_slug: str
    mode: str  # full | daily | monitor | report


class RunOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    domain_id: int | None = None
    mode: str
    stage: str | None = None
    status: str
    triggered_by: str
    stats: dict | None = None
    error: str | None = None
    started_at: datetime
    finished_at: datetime | None = None


class RunLogOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    run_id: int
    agent: str | None = None
    level: str
    message: str
    created_at: datetime
