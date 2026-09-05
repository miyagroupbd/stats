"""Conversation schemas — one correspondence view per lead.

A *conversation* is every real exchange with a lead, merged from three places:

- ``messages`` rows the pipeline or the board actually sent (or tried to):
  status in sent/queued/failed. Drafts (drafted/approved/rejected) are not
  correspondence and never appear here.
- ``events`` of type ``replied`` — inbound mail A7 / the IMAP backfill captured.
- ``events`` of type ``sent_manual`` — outbound mail a human sent from the
  mailbox itself, which the pipeline's Sent-folder scan recorded.

Field names are a shared contract with the stats frontend; keep them stable.
"""
from __future__ import annotations

from datetime import datetime
from typing import Literal

from pydantic import BaseModel

from app.schemas.common import Page

Direction = Literal["inbound", "outbound"]
Source = Literal["pipeline", "board", "mailbox"]


class ThreadItem(BaseModel):
    """One message in a lead's thread, whichever table it came from."""
    id: str  # stable: "m:<message id>" | "e:<event id>"
    direction: Direction
    source: Source
    sender: str | None = None
    recipient: str | None = None
    subject: str | None = None
    body: str | None = None
    kind: str | None = None  # initial / followup_1 / followup_reply / reply / manual
    timestamp: datetime | None = None
    status: str | None = None


class ConversationCounts(BaseModel):
    inbound: int = 0
    outbound: int = 0


class Conversation(BaseModel):
    """List row: the lead plus a summary of the newest item in the thread."""
    lead_id: int
    lead_email: str | None = None
    lead_name: str | None = None
    company: str | None = None
    domain_id: int
    status: str
    replied_at: datetime | None = None
    last_at: datetime
    last_direction: Direction
    last_source: Source
    last_preview: str = ""  # <=160 chars, quoted history stripped
    counts: ConversationCounts


class ConversationPage(Page):
    """Paginated conversation envelope (extends the shared Page primitive)."""
    items: list[Conversation]


class ConversationLead(BaseModel):
    id: int
    email: str
    first_name: str | None = None
    last_name: str | None = None
    company: str | None = None
    domain_id: int
    status: str
    pain_point: str | None = None
    replied_at: datetime | None = None


class ConversationThread(BaseModel):
    lead: ConversationLead
    items: list[ThreadItem]  # chronological, oldest first
