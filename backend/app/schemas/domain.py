"""Domain (business-arm) schemas. SMTP password is write-only."""
from __future__ import annotations

from datetime import datetime

from pydantic import BaseModel, ConfigDict


class DomainBase(BaseModel):
    name: str
    website: str | None = None
    is_active: bool = True
    from_name: str | None = None
    from_email: str | None = None
    reply_to: str | None = None
    signature: str | None = None
    ai_context: str | None = None
    icp_segments: list | None = None
    model: str = "claude-sonnet-5"
    smtp_host: str = "smtp.hostinger.com"
    smtp_port: int = 465
    smtp_user: str | None = None
    smtp_secure: bool = True
    imap_host: str = "imap.hostinger.com"
    imap_port: int = 993
    daily_limit: int = 50
    batch_size: int = 20
    batch_delay_sec: int = 5
    send_days: list[int] | None = None
    send_hour_start: int = 8
    send_hour_end: int = 14
    follow_up_days: int = 3
    max_follow_ups: int = 3
    confidence_threshold: int = 70


class DomainCreate(DomainBase):
    slug: str
    smtp_password: str | None = None  # plaintext in; encrypted at rest


class DomainUpdate(BaseModel):
    """All optional — partial update."""
    name: str | None = None
    website: str | None = None
    is_active: bool | None = None
    from_name: str | None = None
    from_email: str | None = None
    reply_to: str | None = None
    signature: str | None = None
    ai_context: str | None = None
    icp_segments: list | None = None
    model: str | None = None
    smtp_host: str | None = None
    smtp_port: int | None = None
    smtp_user: str | None = None
    smtp_password: str | None = None  # set to change; omit to keep
    smtp_secure: bool | None = None
    imap_host: str | None = None
    imap_port: int | None = None
    daily_limit: int | None = None
    batch_size: int | None = None
    batch_delay_sec: int | None = None
    send_days: list[int] | None = None
    send_hour_start: int | None = None
    send_hour_end: int | None = None
    follow_up_days: int | None = None
    max_follow_ups: int | None = None
    confidence_threshold: int | None = None


class DomainOut(DomainBase):
    model_config = ConfigDict(from_attributes=True)
    id: int
    slug: str
    smtp_configured: bool = False   # derived: has smtp_user + password
    created_at: datetime
    updated_at: datetime
