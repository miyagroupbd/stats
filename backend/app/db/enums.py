"""All enum vocabularies. Stored as VARCHAR (native_enum=False) for painless migrations."""
import enum


class LeadStatus(str, enum.Enum):
    NEW = "new"
    QUALIFIED = "qualified"
    QUEUED = "queued"
    CONTACTED = "contacted"
    REPLIED = "replied"
    BOUNCED = "bounced"
    CONVERTED = "converted"
    DEAD = "dead"
    SUPPRESSED = "suppressed"


class VerifyStatus(str, enum.Enum):
    UNVERIFIED = "unverified"
    VALID = "valid"
    INVALID = "invalid"
    RISKY = "risky"  # catch-all domain — send at reduced volume
    UNKNOWN = "unknown"


class LeadSource(str, enum.Enum):
    APOLLO = "apollo"
    SCRAPE = "scrape"
    MANUAL = "manual"
    IMPORT = "import"
    HUNTER = "hunter"
    SNOV = "snov"


class Priority(str, enum.Enum):
    HOT = "hot"
    WARM = "warm"
    COOL = "cool"
    COLD = "cold"


class CampaignStatus(str, enum.Enum):
    DRAFT = "draft"
    ACTIVE = "active"
    PAUSED = "paused"
    COMPLETED = "completed"


class MessageKind(str, enum.Enum):
    INITIAL = "initial"
    FOLLOWUP_1 = "followup_1"
    FOLLOWUP_2 = "followup_2"
    FOLLOWUP_3 = "followup_3"


class MessageStatus(str, enum.Enum):
    DRAFTED = "drafted"
    QUEUED = "queued"
    SENT = "sent"
    FAILED = "failed"


class EventType(str, enum.Enum):
    DELIVERED = "delivered"
    BOUNCED = "bounced"
    REPLIED = "replied"
    UNSUBSCRIBED = "unsubscribed"


class SuppressionReason(str, enum.Enum):
    BOUNCED = "bounced"
    UNSUBSCRIBED = "unsubscribed"
    MANUAL = "manual"
    COMPLAINED = "complained"


class RunMode(str, enum.Enum):
    FULL = "full"
    DAILY = "daily"
    MONITOR = "monitor"
    REPORT = "report"
    STAGE = "stage"  # single-agent run; Run.stage holds e.g. "a4"


class RunStatus(str, enum.Enum):
    QUEUED = "queued"      # created by the stats board; an engine worker picks it up
    RUNNING = "running"
    SUCCEEDED = "succeeded"
    FAILED = "failed"
    CANCELLED = "cancelled"


class TriggeredBy(str, enum.Enum):
    CLI = "cli"
    DASHBOARD = "dashboard"
    CRON = "cron"


class UserRole(str, enum.Enum):
    SUPERADMIN = "superadmin"
    ADMIN = "admin"
    VIEWER = "viewer"
