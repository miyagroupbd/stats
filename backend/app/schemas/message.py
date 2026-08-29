"""Message schemas."""
from __future__ import annotations

from datetime import datetime

from pydantic import BaseModel, ConfigDict


class MessageEdit(BaseModel):
    """Partial edit of a draft. Omitted fields are left untouched."""
    subject: str | None = None
    subject_b: str | None = None
    body: str | None = None


class GenerateReplyRequest(BaseModel):
    intent: str | None = "book_meeting"  # book_meeting, answer_questions, pricing, short_friendly, custom
    custom_prompt: str | None = None


class GenerateReplyResponse(BaseModel):
    subject: str
    body: str


class SendReplyRequest(BaseModel):
    subject: str
    body: str


class ThreadItem(BaseModel):
    direction: str  # "outbound" (us) | "inbound" (lead)
    sender: str | None = None
    recipient: str | None = None
    subject: str | None = None
    body: str | None = None
    kind: str | None = None  # initial, followup_1, reply, etc.
    timestamp: datetime | str | None = None
    status: str | None = None


class ReplyOut(BaseModel):
    """One received reply (a REPLIED event) paired with the email it answers.

    Reply body/from/date come from event.meta, written by pipeline A7 or backfill.
    """
    id: int  # event id
    lead_id: int
    message_id: int | None = None
    domain_id: int | None = None
    lead_email: str | None = None
    lead_name: str | None = None
    company: str | None = None
    pain_point: str | None = None
    # Their reply
    reply_from: str | None = None
    reply_subject: str | None = None
    reply_body: str | None = None
    reply_date: str | None = None  # raw Date header of the inbound mail
    received_at: datetime  # when the pipeline recorded the reply
    # Our email it answers
    our_kind: str | None = None
    our_subject: str | None = None
    our_body: str | None = None
    our_sent_at: datetime | None = None
    our_from: str | None = None  # the arm's sending address
    # Complete conversation history in chronological order
    thread: list[ThreadItem] = []


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
    from_email: str | None = None  # sending address (derived from the arm's config)
    to_email: str | None = None  # recipient address (derived from the message's lead)
    bounced: bool = False  # derived: the message's lead is in the BOUNCED state
    created_at: datetime
