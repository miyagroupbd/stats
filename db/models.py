"""SQLAlchemy 2.0 models — the whole schema (12 tables).

Design notes:
- Enums stored as VARCHAR (native_enum=False) so adding a value never needs a
  Postgres type migration.
- JSON columns use JSONB.
- Every business row is scoped to a domain (a Miya business arm) except users,
  global suppression rows, email_cache and domain_intel (cross-domain assets).
"""
from __future__ import annotations

from datetime import datetime, timezone

from sqlalchemy import (
    BigInteger,
    Boolean,
    DateTime,
    Enum as SAEnum,
    Float,
    ForeignKey,
    Index,
    Integer,
    String,
    Text,
    UniqueConstraint,
    func,
)
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column, relationship

from db.base import Base
from db.enums import (
    CampaignStatus,
    EventType,
    LeadSource,
    LeadStatus,
    MessageKind,
    MessageStatus,
    Priority,
    RunMode,
    RunStatus,
    SuppressionReason,
    TriggeredBy,
    UserRole,
    VerifyStatus,
)


def _utcnow() -> datetime:
    return datetime.now(timezone.utc)


def _enum(e):
    """VARCHAR-backed enum, values (not names) persisted."""
    return SAEnum(e, native_enum=False, length=32, values_callable=lambda x: [m.value for m in x])


class TimestampMixin:
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=_utcnow, nullable=False
    )


# --------------------------------------------------------------------------- #
# Users — dashboard auth
# --------------------------------------------------------------------------- #
class User(Base, TimestampMixin):
    __tablename__ = "users"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    email: Mapped[str] = mapped_column(String(255), unique=True, nullable=False, index=True)
    name: Mapped[str | None] = mapped_column(String(255))
    password_hash: Mapped[str] = mapped_column(String(255), nullable=False)
    role: Mapped[UserRole] = mapped_column(_enum(UserRole), default=UserRole.ADMIN, nullable=False)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    last_login_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))


# --------------------------------------------------------------------------- #
# Domains — one per Miya business arm; holds sending identity + AI context
# --------------------------------------------------------------------------- #
class Domain(Base, TimestampMixin):
    __tablename__ = "domains"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    slug: Mapped[str] = mapped_column(String(64), unique=True, nullable=False, index=True)
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    website: Mapped[str | None] = mapped_column(String(255))
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)

    # Sending identity
    from_name: Mapped[str | None] = mapped_column(String(255))
    from_email: Mapped[str | None] = mapped_column(String(255))
    reply_to: Mapped[str | None] = mapped_column(String(255))
    signature: Mapped[str | None] = mapped_column(Text)

    # AI configuration
    ai_context: Mapped[str | None] = mapped_column(Text)  # system-prompt prefix (per-arm MGL_CONTEXT)
    icp_segments: Mapped[list | None] = mapped_column(JSONB)  # [{key,label,description}]
    model: Mapped[str] = mapped_column(String(64), default="claude-sonnet-5", nullable=False)

    # SMTP (password encrypted at rest)
    smtp_host: Mapped[str] = mapped_column(String(255), default="smtp.hostinger.com", nullable=False)
    smtp_port: Mapped[int] = mapped_column(Integer, default=465, nullable=False)
    smtp_user: Mapped[str | None] = mapped_column(String(255))
    smtp_pass_enc: Mapped[str | None] = mapped_column(Text)
    smtp_secure: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)

    # IMAP (reuses smtp_user / smtp_pass_enc unless overridden)
    imap_host: Mapped[str] = mapped_column(String(255), default="imap.hostinger.com", nullable=False)
    imap_port: Mapped[int] = mapped_column(Integer, default=993, nullable=False)

    # Send rules
    daily_limit: Mapped[int] = mapped_column(Integer, default=50, nullable=False)
    batch_size: Mapped[int] = mapped_column(Integer, default=20, nullable=False)
    batch_delay_sec: Mapped[int] = mapped_column(Integer, default=5, nullable=False)
    send_days: Mapped[list | None] = mapped_column(JSONB, default=lambda: [1, 2, 3])  # py weekday: Mon=0
    send_hour_start: Mapped[int] = mapped_column(Integer, default=8, nullable=False)   # UTC
    send_hour_end: Mapped[int] = mapped_column(Integer, default=14, nullable=False)    # UTC

    # Follow-up rules
    follow_up_days: Mapped[int] = mapped_column(Integer, default=3, nullable=False)
    max_follow_ups: Mapped[int] = mapped_column(Integer, default=3, nullable=False)
    confidence_threshold: Mapped[int] = mapped_column(Integer, default=70, nullable=False)

    # Relationships
    campaigns: Mapped[list[Campaign]] = relationship(back_populates="domain", cascade="all, delete-orphan")
    leads: Mapped[list[Lead]] = relationship(back_populates="domain", cascade="all, delete-orphan")
    runs: Mapped[list[Run]] = relationship(back_populates="domain", cascade="all, delete-orphan")


# --------------------------------------------------------------------------- #
# Campaigns
# --------------------------------------------------------------------------- #
class Campaign(Base, TimestampMixin):
    __tablename__ = "campaigns"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    domain_id: Mapped[int] = mapped_column(ForeignKey("domains.id", ondelete="CASCADE"), nullable=False, index=True)
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    description: Mapped[str | None] = mapped_column(Text)
    status: Mapped[CampaignStatus] = mapped_column(_enum(CampaignStatus), default=CampaignStatus.DRAFT, nullable=False)

    domain: Mapped[Domain] = relationship(back_populates="campaigns")
    leads: Mapped[list[Lead]] = relationship(back_populates="campaign")
    messages: Mapped[list[Message]] = relationship(back_populates="campaign")


# --------------------------------------------------------------------------- #
# Leads
# --------------------------------------------------------------------------- #
class Lead(Base, TimestampMixin):
    __tablename__ = "leads"
    __table_args__ = (
        UniqueConstraint("domain_id", "email", name="uq_leads_domain_email"),
        Index("ix_leads_domain_status", "domain_id", "status"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    domain_id: Mapped[int] = mapped_column(ForeignKey("domains.id", ondelete="CASCADE"), nullable=False, index=True)
    campaign_id: Mapped[int | None] = mapped_column(ForeignKey("campaigns.id", ondelete="SET NULL"), index=True)

    # Contact
    email: Mapped[str] = mapped_column(String(320), nullable=False, index=True)
    first_name: Mapped[str | None] = mapped_column(String(120))
    last_name: Mapped[str | None] = mapped_column(String(120))
    title: Mapped[str | None] = mapped_column(String(255))
    linkedin_url: Mapped[str | None] = mapped_column(String(500))
    phone: Mapped[str | None] = mapped_column(String(64))

    # Company
    company: Mapped[str | None] = mapped_column(String(255))
    company_domain: Mapped[str | None] = mapped_column(String(255), index=True)
    industry: Mapped[str | None] = mapped_column(String(255))
    country: Mapped[str | None] = mapped_column(String(120))
    employee_count: Mapped[int | None] = mapped_column(Integer)

    # Pipeline state
    status: Mapped[LeadStatus] = mapped_column(_enum(LeadStatus), default=LeadStatus.NEW, nullable=False, index=True)
    segment: Mapped[str | None] = mapped_column(String(8))       # A/B/C/D
    priority: Mapped[Priority | None] = mapped_column(_enum(Priority))
    score: Mapped[int | None] = mapped_column(Integer)
    source: Mapped[LeadSource] = mapped_column(_enum(LeadSource), default=LeadSource.MANUAL, nullable=False)

    # Verification
    verify_status: Mapped[VerifyStatus] = mapped_column(_enum(VerifyStatus), default=VerifyStatus.UNVERIFIED, nullable=False)
    verify_confidence: Mapped[int | None] = mapped_column(Integer)

    # Intelligence (A3 analyzer output)
    pain_point: Mapped[str | None] = mapped_column(Text)
    hook: Mapped[str | None] = mapped_column(Text)
    analysis: Mapped[dict | None] = mapped_column(JSONB)
    notes: Mapped[str | None] = mapped_column(Text)

    # Follow-up bookkeeping (first-class, not free text)
    follow_up_count: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    last_contacted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    replied_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))

    domain: Mapped[Domain] = relationship(back_populates="leads")
    campaign: Mapped[Campaign | None] = relationship(back_populates="leads")
    messages: Mapped[list[Message]] = relationship(back_populates="lead", cascade="all, delete-orphan")
    events: Mapped[list[Event]] = relationship(back_populates="lead", cascade="all, delete-orphan")


# --------------------------------------------------------------------------- #
# Messages — every email drafted/sent
# --------------------------------------------------------------------------- #
class Message(Base, TimestampMixin):
    __tablename__ = "messages"
    __table_args__ = (
        Index("ix_messages_smtp_message_id", "smtp_message_id"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    lead_id: Mapped[int] = mapped_column(ForeignKey("leads.id", ondelete="CASCADE"), nullable=False, index=True)
    campaign_id: Mapped[int | None] = mapped_column(ForeignKey("campaigns.id", ondelete="SET NULL"), index=True)

    kind: Mapped[MessageKind] = mapped_column(_enum(MessageKind), default=MessageKind.INITIAL, nullable=False)
    subject: Mapped[str | None] = mapped_column(String(500))
    subject_b: Mapped[str | None] = mapped_column(String(500))  # A/B alternate
    body: Mapped[str | None] = mapped_column(Text)
    status: Mapped[MessageStatus] = mapped_column(_enum(MessageStatus), default=MessageStatus.DRAFTED, nullable=False)

    smtp_message_id: Mapped[str | None] = mapped_column(String(500))  # RFC Message-ID for reply threading
    error: Mapped[str | None] = mapped_column(Text)
    sent_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))

    lead: Mapped[Lead] = relationship(back_populates="messages")
    campaign: Mapped[Campaign | None] = relationship(back_populates="messages")
    events: Mapped[list[Event]] = relationship(back_populates="message")


# --------------------------------------------------------------------------- #
# Events — delivery / bounce / reply / unsubscribe
# --------------------------------------------------------------------------- #
class Event(Base):
    __tablename__ = "events"

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True)
    lead_id: Mapped[int] = mapped_column(ForeignKey("leads.id", ondelete="CASCADE"), nullable=False, index=True)
    message_id: Mapped[int | None] = mapped_column(ForeignKey("messages.id", ondelete="SET NULL"), index=True)
    type: Mapped[EventType] = mapped_column(_enum(EventType), nullable=False, index=True)
    detail: Mapped[str | None] = mapped_column(Text)
    meta: Mapped[dict | None] = mapped_column(JSONB)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)

    lead: Mapped[Lead] = relationship(back_populates="events")
    message: Mapped[Message | None] = relationship(back_populates="events")


# --------------------------------------------------------------------------- #
# Suppression — do-not-contact registry (per domain or global when domain_id NULL)
# --------------------------------------------------------------------------- #
class Suppression(Base):
    __tablename__ = "suppression"
    __table_args__ = (
        UniqueConstraint("domain_id", "email", name="uq_suppression_domain_email"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    domain_id: Mapped[int | None] = mapped_column(ForeignKey("domains.id", ondelete="CASCADE"), index=True)
    email: Mapped[str] = mapped_column(String(320), nullable=False, index=True)
    reason: Mapped[SuppressionReason] = mapped_column(_enum(SuppressionReason), default=SuppressionReason.MANUAL, nullable=False)
    detail: Mapped[str | None] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)


# --------------------------------------------------------------------------- #
# Runs — job model for pipeline executions (drives dashboard live view)
# --------------------------------------------------------------------------- #
class Run(Base):
    __tablename__ = "runs"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    domain_id: Mapped[int | None] = mapped_column(ForeignKey("domains.id", ondelete="CASCADE"), index=True)
    mode: Mapped[RunMode] = mapped_column(_enum(RunMode), nullable=False)
    stage: Mapped[str | None] = mapped_column(String(32))  # for single-agent runs, e.g. "a4"
    status: Mapped[RunStatus] = mapped_column(_enum(RunStatus), default=RunStatus.RUNNING, nullable=False, index=True)
    triggered_by: Mapped[TriggeredBy] = mapped_column(_enum(TriggeredBy), default=TriggeredBy.CLI, nullable=False)

    stats: Mapped[dict | None] = mapped_column(JSONB)  # counts: leads_in, sent, bounced, ...
    error: Mapped[str | None] = mapped_column(Text)
    started_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    finished_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))

    domain: Mapped[Domain | None] = relationship(back_populates="runs")
    logs: Mapped[list[RunLog]] = relationship(back_populates="run", cascade="all, delete-orphan")


class RunLog(Base):
    __tablename__ = "run_logs"
    __table_args__ = (
        Index("ix_run_logs_run_id_id", "run_id", "id"),
    )

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True)
    run_id: Mapped[int] = mapped_column(ForeignKey("runs.id", ondelete="CASCADE"), nullable=False)
    agent: Mapped[str | None] = mapped_column(String(32))   # a1..a10
    level: Mapped[str] = mapped_column(String(16), default="info", nullable=False)
    message: Mapped[str] = mapped_column(Text, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)

    run: Mapped[Run] = relationship(back_populates="logs")


# --------------------------------------------------------------------------- #
# Own verification asset — cache + learned per-company intel
# --------------------------------------------------------------------------- #
class EmailCache(Base):
    __tablename__ = "email_cache"

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True)
    email: Mapped[str] = mapped_column(String(320), unique=True, nullable=False, index=True)
    verify_status: Mapped[VerifyStatus] = mapped_column(_enum(VerifyStatus), nullable=False)
    confidence: Mapped[int | None] = mapped_column(Integer)
    provider: Mapped[str | None] = mapped_column(String(32))  # own/apollo/hunter/snov
    is_catch_all: Mapped[bool | None] = mapped_column(Boolean)
    raw: Mapped[dict | None] = mapped_column(JSONB)
    checked_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)


class DomainIntel(Base, TimestampMixin):
    __tablename__ = "domain_intel"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    company_domain: Mapped[str] = mapped_column(String(255), unique=True, nullable=False, index=True)
    mx_provider: Mapped[str | None] = mapped_column(String(120))   # google/microsoft/other
    is_catch_all: Mapped[bool | None] = mapped_column(Boolean)
    email_pattern: Mapped[str | None] = mapped_column(String(64))  # learned, e.g. "{first}.{last}"
    pattern_confidence: Mapped[float | None] = mapped_column(Float)
    verified_count: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    raw: Mapped[dict | None] = mapped_column(JSONB)


# --------------------------------------------------------------------------- #
# Settings — global app KV (feature flags, default model, provider selection)
# --------------------------------------------------------------------------- #
class Setting(Base, TimestampMixin):
    __tablename__ = "settings"

    key: Mapped[str] = mapped_column(String(120), primary_key=True)
    value: Mapped[dict | None] = mapped_column(JSONB)
