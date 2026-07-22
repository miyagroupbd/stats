"""Message schemas."""
from __future__ import annotations

from datetime import datetime

from pydantic import BaseModel, ConfigDict


class MessageOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    lead_id: int
    campaign_id: int | None = None
    kind: str
    subject: str | None = None
    subject_b: str | None = None
    body: str | None = None
    status: str
    smtp_message_id: str | None = None
    error: str | None = None
    sent_at: datetime | None = None
    approved_at: datetime | None = None
    approved_by: str | None = None
    created_at: datetime
