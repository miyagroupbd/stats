"""Messages router — read-only listing of drafted/sent emails for the dashboard.

Every email the pipeline drafts or sends is a Message row (belonging to a Lead,
which belongs to a Domain). These endpoints let the dashboard page through a
domain's messages, filtered by delivery status and follow-up kind, and fetch a
single message by id. Read-only: no admin gate beyond authentication.
"""
from __future__ import annotations

import email
import email.utils
import imaplib
import logging
import ssl
from datetime import datetime, timezone
from typing import Any

from fastapi import APIRouter, Body, Depends, HTTPException, Query, status
from prisma import Json

from app.core.db import prisma
from app.core.security import decrypt
from app.deps import get_current_user, require_admin
from app.schemas.common import Page
from app.schemas.message import MessageEdit, MessageOut, ReplyOut, ThreadItem
from app.services import runner

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/messages", tags=["messages"])

MESSAGE_STATUSES = {"drafted", "approved", "rejected", "queued", "sent", "failed"}
MESSAGE_KINDS = {"initial", "followup_1", "followup_2", "followup_3"}


class MessagePage(Page):
    """Paginated Message envelope (extends the shared Page primitive)."""
    items: list[MessageOut]


class ReplyPage(Page):
    """Paginated received-replies envelope."""
    items: list[ReplyOut]


async def _resolve_domain_id(domain: str) -> int:
    """Resolve a ?domain= that is a slug OR a numeric id; 404 if missing."""
    dom = await prisma.domains.find_unique(where={"slug": domain})
    if dom is None and domain.isdigit():
        dom = await prisma.domains.find_unique(where={"id": int(domain)})
    if dom is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Domain not found")
    return dom.id


async def _scan_and_backfill_imap(domains_list: list[Any]) -> int:
    """Directly scans IMAP inboxes for domains to recover real reply bodies and match leads."""
    backfilled_count = 0
    for dom in domains_list:
        if not dom.imap_host or not dom.smtp_user or not dom.smtp_pass_enc:
            continue
        try:
            password = decrypt(dom.smtp_pass_enc)
            if not password:
                continue
            port = int(dom.imap_port or 993)
            ctx = ssl.create_default_context()
            with imaplib.IMAP4_SSL(dom.imap_host, port, ssl_context=ctx) as m:
                m.login(dom.smtp_user, password)
                m.select("INBOX")
                typ, data = m.search(None, "ALL")
                if typ != "OK" or not data or not data[0]:
                    continue
                msg_ids = data[0].split()[-250:]
                for mid in msg_ids:
                    try:
                        typ, msg_data = m.fetch(mid, "(BODY.PEEK[])")
                        if typ != "OK" or not msg_data or not msg_data[0]:
                            continue
                        parsed = email.message_from_bytes(msg_data[0][1])
                        from_header = parsed.get("From", "")
                        from_email = email.utils.parseaddr(from_header)[1].lower().strip()
                        if not from_email:
                            continue
                        # Filter out common automated bounces
                        if any(b in from_email for b in ("mailer-daemon", "postmaster", "bounce", "noreply", "no-reply")):
                            continue

                        subject = parsed.get("Subject", "") or "Re: Outreach"
                        in_reply_to = (parsed.get("In-Reply-To", "") or "").strip()
                        imap_msg_id = (parsed.get("Message-ID", "") or "").strip()
                        date_str = parsed.get("Date", "")

                        # Cleanly extract body
                        body = ""
                        if parsed.is_multipart():
                            for part in parsed.walk():
                                ct = part.get_content_type()
                                if ct == "text/plain":
                                    try:
                                        body = part.get_payload(decode=True).decode(errors="replace")
                                        break
                                    except Exception:
                                        pass
                                elif ct == "text/html" and not body:
                                    try:
                                        body = part.get_payload(decode=True).decode(errors="replace")
                                    except Exception:
                                        pass
                        else:
                            try:
                                body = parsed.get_payload(decode=True).decode(errors="replace")
                            except Exception:
                                body = str(parsed.get_payload())

                        if not body:
                            body = f"Reply received from {from_email}"

                        # Match to lead
                        lead = None
                        if in_reply_to:
                            msg_row = await prisma.messages.find_first(where={"smtp_message_id": in_reply_to})
                            if msg_row and msg_row.lead_id:
                                lead = await prisma.leads.find_unique(where={"id": msg_row.lead_id}, include={"messages": True})

                        if lead is None:
                            lead = await prisma.leads.find_first(
                                where={"email": {"equals": from_email, "mode": "insensitive"}, "domain_id": dom.id},
                                include={"messages": True}
                            )

                        if lead is None:
                            sender_dom = from_email.split("@")[-1]
                            if sender_dom and sender_dom not in ("gmail.com", "yahoo.com", "outlook.com", "hotmail.com", "icloud.com"):
                                lead = await prisma.leads.find_first(
                                    where={"email": {"endswith": "@" + sender_dom, "mode": "insensitive"}, "domain_id": dom.id},
                                    include={"messages": True}
                                )

                        if lead is not None:
                            meta_payload = {
                                "from": from_header,
                                "subject": subject,
                                "body": body[:20000],
                                "date": date_str,
                                "imap_message_id": imap_msg_id,
                            }
                            existing_ev = await prisma.events.find_first(
                                where={"lead_id": lead.id, "type": "replied"}
                            )
                            if existing_ev is None:
                                await prisma.events.create(
                                    data={
                                        "lead_id": lead.id,
                                        "message_id": lead.messages[0].id if getattr(lead, "messages", None) else None,
                                        "type": "replied",
                                        "detail": subject,
                                        "meta": Json(meta_payload),
                                    }
                                )
                                backfilled_count += 1
                            else:
                                ev_meta = existing_ev.meta if isinstance(existing_ev.meta, dict) else {}
                                if not ev_meta.get("body") or str(ev_meta.get("body")).startswith("body not captured"):
                                    await prisma.events.update(
                                        where={"id": existing_ev.id},
                                        data={"meta": Json(meta_payload)}
                                    )
                                    backfilled_count += 1

                            await prisma.leads.update(
                                where={"id": lead.id},
                                data={"status": "replied"}
                            )
                    except Exception as exc:
                        logger.warning("Error processing single IMAP message: %s", exc)
        except Exception as exc:
            logger.warning("IMAP connection error for domain %s: %s", getattr(dom, 'slug', 'unknown'), exc)
    return backfilled_count


@router.get("/", response_model=MessagePage)
async def list_messages(
    domain: str | None = Query(None, description="Domain slug or id; omit for all domains"),
    status_: str | None = Query(None, alias="status", description="MessageStatus filter"),
    kind: str | None = Query(None, description="MessageKind filter"),
    limit: int = Query(50, ge=1, le=500),
    offset: int = Query(0, ge=0),
    _user=Depends(get_current_user),
) -> MessagePage:
    where: dict[str, Any] = {}
    if domain is not None:
        domain_id = await _resolve_domain_id(domain)
        where["leads"] = {"is": {"domain_id": domain_id}}

    if status_ is not None:
        if status_ not in MESSAGE_STATUSES:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"Invalid status '{status_}'",
            )
        where["status"] = status_

    if kind is not None:
        if kind not in MESSAGE_KINDS:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"Invalid kind '{kind}'",
            )
        where["kind"] = kind

    total = await prisma.messages.count(where=where)

    rows = await prisma.messages.find_many(
        where=where,
        order={"id": "desc"},
        take=limit,
        skip=offset,
        include={"leads": True},
    )

    domains = await prisma.domains.find_many()
    from_by_domain = {d.id: (d.from_email or d.smtp_user) for d in domains}

    items = []
    for m in rows:
        out = MessageOut.model_validate(m)
        lead = getattr(m, "leads", None)
        if lead is not None:
            out.from_email = from_by_domain.get(lead.domain_id)
            out.to_email = lead.email
            out.bounced = lead.status == "bounced"
        items.append(out)

    return MessagePage(items=items, total=total, limit=limit, offset=offset)


@router.get("/replies", response_model=ReplyPage)
async def list_replies(
    domain: str | None = Query(None, description="Domain slug or id; omit for all domains"),
    limit: int = Query(50, ge=1, le=500),
    offset: int = Query(0, ge=0),
    _user=Depends(get_current_user),
) -> ReplyPage:
    """Every reply received — deduplicated by lead, with complete back-and-forth conversation thread."""
    where_events: dict[str, Any] = {"type": "replied"}
    where_leads: dict[str, Any] = {"OR": [{"status": "replied"}, {"replied_at": {"not": None}}]}
    if domain is not None:
        domain_id = await _resolve_domain_id(domain)
        where_events["leads"] = {"is": {"domain_id": domain_id}}
        where_leads["domain_id"] = domain_id

    rows = await prisma.events.find_many(
        where=where_events,
        order={"id": "desc"},
        include={"leads": True, "messages": True},
    )

    domains = await prisma.domains.find_many()
    from_by_domain = {d.id: (d.from_email or d.smtp_user) for d in domains}

    by_lead: dict[int, ReplyOut] = {}

    for ev in rows:
        lead = getattr(ev, "leads", None)
        if lead is None or not ev.lead_id:
            continue

        lead_id = ev.lead_id
        msg = getattr(ev, "messages", None)
        if msg is None and getattr(lead, "messages", None):
            msg = lead.messages[0]

        meta = ev.meta if isinstance(ev.meta, dict) else {}
        name = " ".join(p for p in (lead.first_name, lead.last_name) if p) or None

        reply_from = meta.get("from") or lead.email
        reply_subject = meta.get("subject") or ev.detail or "Re: Outreach"
        reply_body = (
            meta.get("body")
            or meta.get("text")
            or meta.get("content")
            or meta.get("snippet")
            or meta.get("notes")
            or (ev.detail if ev.detail and ev.detail != (meta.get("subject") or "") else None)
            or (lead.notes if lead and lead.notes else None)
        )

        candidate = ReplyOut(
            id=ev.id,
            lead_id=lead_id,
            message_id=ev.message_id or (msg.id if msg else None),
            domain_id=lead.domain_id,
            lead_email=lead.email,
            lead_name=name,
            company=lead.company,
            pain_point=lead.pain_point,
            reply_from=reply_from,
            reply_subject=reply_subject,
            reply_body=reply_body,
            reply_date=meta.get("date"),
            received_at=ev.created_at,
            our_kind=msg.kind if msg else None,
            our_subject=msg.subject if msg else None,
            our_body=msg.body if msg else None,
            our_sent_at=msg.sent_at if msg else None,
            our_from=from_by_domain.get(lead.domain_id),
            thread=[],
        )

        existing = by_lead.get(lead_id)
        if existing is None:
            by_lead[lead_id] = candidate
        else:
            cand_has_body = bool(candidate.reply_body and not str(candidate.reply_body).startswith("body not captured"))
            exist_has_body = bool(existing.reply_body and not str(existing.reply_body).startswith("body not captured"))
            if cand_has_body and not exist_has_body:
                by_lead[lead_id] = candidate
            elif candidate.received_at > existing.received_at and (cand_has_body == exist_has_body):
                by_lead[lead_id] = candidate

    replied_leads = await prisma.leads.find_many(
        where=where_leads,
        include={"messages": True},
    )

    for lead in replied_leads:
        if lead.id not in by_lead:
            name = " ".join(p for p in (lead.first_name, lead.last_name) if p) or None
            msg = lead.messages[0] if getattr(lead, "messages", None) else None
            by_lead[lead.id] = ReplyOut(
                id=-lead.id,
                lead_id=lead.id,
                message_id=msg.id if msg else None,
                domain_id=lead.domain_id,
                lead_email=lead.email,
                lead_name=name,
                company=lead.company,
                pain_point=lead.pain_point,
                reply_from=lead.email,
                reply_subject="Re: " + (msg.subject if msg and msg.subject else "Outreach"),
                reply_body=lead.notes or f"Reply recorded for lead {lead.email}",
                reply_date=None,
                received_at=lead.replied_at or lead.updated_at or datetime.now(timezone.utc),
                our_kind=msg.kind if msg else None,
                our_subject=msg.subject if msg else None,
                our_body=msg.body if msg else None,
                our_sent_at=msg.sent_at if msg else None,
                our_from=from_by_domain.get(lead.domain_id),
                thread=[],
            )

    items: list[ReplyOut] = sorted(by_lead.values(), key=lambda x: x.received_at, reverse=True)
    total = len(items)
    page_items = items[offset:offset + limit]

    # Build full conversation thread for each item in the page
    for item in page_items:
        thread: list[ThreadItem] = []
        # All messages sent to this lead
        lead_messages = await prisma.messages.find_many(
            where={"lead_id": item.lead_id},
            order={"id": "asc"},
        )
        for m in lead_messages:
            thread.append(ThreadItem(
                direction="outbound",
                sender=item.our_from or f"{item.company or 'Lead'} Outreach",
                recipient=item.lead_email,
                subject=m.subject,
                body=m.body,
                kind=m.kind,
                timestamp=m.sent_at or m.created_at,
                status=m.status,
            ))

        # All replies from this lead (deduplicated by message/body)
        lead_events = await prisma.events.find_many(
            where={"lead_id": item.lead_id, "type": "replied"},
            order={"id": "desc"},
        )
        unique_inbound: dict[str, ThreadItem] = {}
        for ev in lead_events:
            ev_meta = ev.meta if isinstance(ev.meta, dict) else {}
            body_txt = (
                ev_meta.get("body")
                or ev_meta.get("text")
                or ev_meta.get("snippet")
                or ev_meta.get("notes")
                or (ev.detail if ev.detail and ev.detail != ev_meta.get("subject") else None)
                or item.reply_body
            )
            subj = ev_meta.get("subject") or ev.detail or item.reply_subject or "Re: Outreach"
            imap_id = (ev_meta.get("imap_message_id") or "").strip()

            if imap_id:
                dedup_k = f"imap:{imap_id}"
            else:
                norm_body = "".join(c.lower() for c in (body_txt or "")[:80] if c.isalnum())
                norm_subj = "".join(c.lower() for c in (subj or "") if c.isalnum())
                dedup_k = f"subj_body:{norm_subj}:{norm_body}"

            item_cand = ThreadItem(
                direction="inbound",
                sender=ev_meta.get("from") or item.reply_from or item.lead_email,
                recipient=item.our_from or "Miya Outreach",
                subject=subj,
                body=body_txt,
                kind="reply",
                timestamp=ev.created_at,
                status="replied",
            )
            if dedup_k not in unique_inbound:
                unique_inbound[dedup_k] = item_cand
            else:
                if item_cand.body and not unique_inbound[dedup_k].body:
                    unique_inbound[dedup_k] = item_cand

        for in_msg in reversed(list(unique_inbound.values())):
            thread.append(in_msg)

        if not unique_inbound and item.reply_body:
            thread.append(ThreadItem(
                direction="inbound",
                sender=item.reply_from or item.lead_email,
                recipient=item.our_from or "Miya Outreach",
                subject=item.reply_subject,
                body=item.reply_body,
                kind="reply",
                timestamp=item.received_at,
                status="replied",
            ))

        item.thread = thread

    return ReplyPage(items=page_items, total=total, limit=limit, offset=offset)


@router.post("/replies/backfill")
async def backfill_replies(
    _user=Depends(get_current_user),
    domain: Any = Body(None),
) -> dict:
    """Recover old reply bodies: scan IMAP inboxes directly and queue worker."""
    domain_slug = None
    if isinstance(domain, dict):
        domain_slug = domain.get("domain")
    elif isinstance(domain, str):
        domain_slug = domain

    if domain_slug:
        dom = await prisma.domains.find_unique(where={"slug": domain_slug})
        if dom is None:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Domain not found")
        doms = [dom]
    else:
        doms = await prisma.domains.find_many(where={"is_active": True})

    # 1. Direct IMAP inbox recovery
    direct_count = 0
    try:
        direct_count = await _scan_and_backfill_imap(doms)
    except Exception as exc:
        logger.error("Direct IMAP scan failed: %s", exc)

    # 2. Database metadata sync
    replied_events = await prisma.events.find_many(where={"type": "replied"}, include={"leads": True})
    for ev in replied_events:
        try:
            meta = ev.meta if isinstance(ev.meta, dict) else {}
            if not meta.get("body"):
                lead = getattr(ev, "leads", None)
                fallback_body = (
                    meta.get("snippet")
                    or meta.get("text")
                    or (ev.detail if ev.detail and ev.detail != meta.get("subject") else None)
                    or (lead.notes if lead and lead.notes else None)
                )
                if fallback_body:
                    new_meta = dict(meta)
                    new_meta["body"] = fallback_body
                    await prisma.events.update(
                        where={"id": ev.id},
                        data={"meta": Json(new_meta)},
                    )
        except Exception:
            pass

    # 3. Secondary runner queue
    run_ids: dict[str, int] = {}
    for d in doms:
        try:
            run_ids[d.slug] = await runner.start_run(domain_slug=d.slug, mode="monitor", stage="backfill")
        except Exception as exc:
            logger.warning("Could not enqueue runner for %s: %s", d.slug, exc)

    return {
        "ok": True,
        "backfilled": direct_count,
        "queued": run_ids,
        "message": f"Backfill finished: {direct_count} replies recovered from IMAP, {len(run_ids)} monitor runs queued.",
    }


@router.post("/replies/{lead_id}/generate-reply", response_model=GenerateReplyResponse)
async def generate_ai_reply(
    lead_id: int,
    req: GenerateReplyRequest = Body(...),
    _user=Depends(get_current_user),
) -> GenerateReplyResponse:
    """Generate an AI-powered conversational reply for this lead based on history & intent."""
    lead = await prisma.leads.find_unique(where={"id": lead_id}, include={"domains": True, "messages": True})
    if lead is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Lead not found")

    domain = lead.domains
    lead_name = " ".join(p for p in (lead.first_name, lead.last_name) if p) or lead.first_name or "there"
    company = lead.company or "your team"
    pain_point = lead.pain_point or "scaling your operations"

    # Collect conversation history
    events = await prisma.events.find_many(where={"lead_id": lead_id, "type": "replied"}, order={"id": "desc"})
    last_reply_body = ""
    last_reply_subject = "Re: Outreach"
    if events:
        ev_meta = events[0].meta if isinstance(events[0].meta, dict) else {}
        last_reply_body = ev_meta.get("body") or ev_meta.get("text") or events[0].detail or ""
        last_reply_subject = ev_meta.get("subject") or "Re: Outreach"
    elif lead.notes:
        last_reply_body = lead.notes

    sent_msgs = await prisma.messages.find_many(where={"lead_id": lead_id}, order={"id": "asc"})
    sent_history = "\n\n".join(f"[{m.kind.upper()}] Subject: {m.subject}\nBody:\n{m.body}" for m in sent_msgs)

    intent_instructions = {
        "book_meeting": "Goal: Acknowledge their reply warmly, address any questions briefly, and propose a concise 10-15 minute introductory call or demo at a specific time (e.g. 'How does Thursday 2 PM or Friday morning work for you?').",
        "answer_questions": "Goal: Directly and clearly answer their questions with helpful details, reassuring them about capabilities and results, ending with an open invitation to explore further.",
        "pricing": "Goal: Explain pricing flexibly and transparently, emphasize high ROI and tailored fit, and suggest a brief walkthrough to provide an exact scope/quote.",
        "short_friendly": "Goal: Keep the response ultra-short (2-3 sentences), warm, conversational, and direct.",
        "custom": req.custom_prompt or "Goal: Respond conversationally and helpfully to move the relationship forward.",
    }
    goal = intent_instructions.get(req.intent or "book_meeting", intent_instructions["book_meeting"])

    # Try Anthropic Claude
    import os
    anthropic_key = os.getenv("ANTHROPIC_API_KEY", "")
    reply_text = None
    if anthropic_key:
        try:
            import anthropic
            client = anthropic.Anthropic(api_key=anthropic_key)
            system_prompt = (
                f"You are an expert sales strategist and copywriter representing {domain.name if domain else 'Miya Group'}.\n"
                f"Your goal is to write a high-converting, natural, authentic, and human email/chat response to a prospect.\n\n"
                f"Company / Service Context:\n{domain.ai_context if domain and domain.ai_context else 'B2B Solutions & Growth Engineering'}\n\n"
                f"Guidelines:\n"
                f"- Write directly to the person ({lead_name}).\n"
                f"- Tone: Warm, confident, respectful, concise, and helpful (like a human conversation on WhatsApp/Email).\n"
                f"- Keep it concise: 2 to 4 short paragraphs max.\n"
                f"- Do NOT use robotic sales fluff ('I hope this email finds you well', 'transformative synergy', etc.).\n"
                f"- Include a natural sign-off using '{domain.from_name if domain and domain.from_name else 'Best regards'}'.\n"
                f"- Return ONLY the final email body text."
            )
            user_prompt = (
                f"PROSPECT INFORMATION:\n"
                f"Name: {lead_name}\n"
                f"Company: {company}\n"
                f"Pain Point: {pain_point}\n\n"
                f"PREVIOUS OUTBOUND EMAILS WE SENT:\n{sent_history or '(Initial outreach)'}\n\n"
                f"THEIR INBOUND REPLY TO US:\n{last_reply_body or '(They expressed interest/replied)'}\n\n"
                f"OBJECTIVE / DESIRED ACTION:\n{goal}\n"
            )
            resp = client.messages.create(
                model=domain.model if domain and domain.model else "claude-3-5-sonnet-20241022",
                max_tokens=800,
                system=system_prompt,
                messages=[{"role": "user", "content": user_prompt}],
            )
            parts = [b.text for b in resp.content if getattr(b, "text", None)]
            reply_text = "".join(parts).strip()
        except Exception as exc:
            logger.warning("Anthropic completion error: %s", exc)

    # Fallback template if no key or error
    if not reply_text:
        sender_name = (domain.from_name if domain and domain.from_name else "Team")
        if req.intent == "pricing":
            reply_text = (
                f"Hi {lead_name},\n\n"
                f"Thanks for getting back to me! Regarding pricing for {company}, we tailor our solutions based on your specific setup and volume so you only pay for what delivers ROI.\n\n"
                f"To give you an accurate number in 5 minutes, do you have a few minutes this Thursday or Friday for a quick intro chat?\n\n"
                f"Best,\n{sender_name}"
            )
        elif req.intent == "short_friendly":
            reply_text = (
                f"Hi {lead_name},\n\n"
                f"Appreciate the reply! Would love to show you how we've helped companies like {company} tackle {pain_point}.\n\n"
                f"Would you be open to a quick 10-minute chat this week?\n\n"
                f"Best,\n{sender_name}"
            )
        else:
            reply_text = (
                f"Hi {lead_name},\n\n"
                f"Thanks for following up! I'd love to share how we can specifically help {company} address {pain_point}.\n\n"
                f"Do you have 10-15 minutes this Thursday afternoon or Friday morning for a quick chat to explore this?\n\n"
                f"Best regards,\n{sender_name}"
            )

    subject_clean = last_reply_subject
    if not subject_clean.lower().startswith("re:"):
        subject_clean = f"Re: {subject_clean}"

    return GenerateReplyResponse(subject=subject_clean, body=reply_text)


@router.post("/replies/{lead_id}/send-reply")
async def send_reply_email(
    lead_id: int,
    req: SendReplyRequest = Body(...),
    _user=Depends(get_current_user),
) -> dict:
    """Send an email reply directly to the lead via SMTP and record it in the database."""
    import smtplib
    from email.message import EmailMessage
    from email.utils import make_msgid

    lead = await prisma.leads.find_unique(where={"id": lead_id}, include={"domains": True})
    if lead is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Lead not found")
    if not lead.email:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Lead has no email address")

    domain = lead.domains
    if domain is None:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Lead has no associated domain")

    if not domain.smtp_host or not domain.smtp_user or not domain.smtp_pass_enc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="SMTP is not configured for this domain")

    password = decrypt(domain.smtp_pass_enc)
    if not password:
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail="Failed to decrypt SMTP password")

    from_email = domain.from_email or domain.smtp_user
    from_name = domain.from_name

    # Build RFC email message
    msg = EmailMessage()
    msg["From"] = f"{from_name} <{from_email}>" if from_name else from_email
    msg["To"] = lead.email
    msg["Subject"] = req.subject
    if domain.reply_to:
        msg["Reply-To"] = domain.reply_to

    domain_part = from_email.split("@")[-1] if "@" in from_email else "miyagroupbd.com"
    msg_id = make_msgid(domain=domain_part)
    msg["Message-ID"] = msg_id
    msg.set_content(req.body)

    # Dispatch via SMTP
    try:
        port = int(domain.smtp_port)
        if domain.smtp_secure and port == 465:
            with smtplib.SMTP_SSL(domain.smtp_host, port, context=ssl.create_default_context()) as s:
                s.login(domain.smtp_user, password)
                s.send_message(msg)
        else:
            with smtplib.SMTP(domain.smtp_host, port) as s:
                s.starttls(context=ssl.create_default_context())
                s.login(domain.smtp_user, password)
                s.send_message(msg)
    except Exception as exc:
        logger.error("Failed to send SMTP reply to %s: %s", lead.email, exc)
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail=f"SMTP Send Error: {exc}")

    # Best-effort IMAP append to Sent folder
    if domain.imap_host:
        try:
            with imaplib.IMAP4_SSL(domain.imap_host, int(domain.imap_port or 993), timeout=10) as m_imap:
                m_imap.login(domain.smtp_user, password)
                for folder in ("INBOX.Sent", "Sent", "INBOX.Sent Items", "Sent Items"):
                    try:
                        typ, _ = m_imap.append(folder, "(\\Seen)", None, msg.as_bytes())
                        if typ == "OK":
                            break
                    except Exception:
                        continue
        except Exception:
            pass

    # Save sent record in database
    now = datetime.now(timezone.utc)
    new_m = await prisma.messages.create(
        data={
            "lead_id": lead.id,
            "campaign_id": lead.campaign_id,
            "kind": "followup_reply",
            "subject": req.subject,
            "body": req.body,
            "status": "sent",
            "smtp_message_id": msg_id,
            "sent_at": now,
        }
    )

    return {
        "ok": True,
        "message_id": new_m.id,
        "sent_at": now.isoformat(),
        "from": from_email,
        "to": lead.email,
    }


@router.get("/{message_id}", response_model=MessageOut)
async def get_message(
    message_id: int,
    _user=Depends(get_current_user),
) -> MessageOut:
    msg = await prisma.messages.find_unique(where={"id": message_id})
    if msg is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Message not found")
    return MessageOut.model_validate(msg)


# --------------------------------------------------------------------------- #
# Human approval gate — the connector between the board and the sender.
#
# The pipeline only DRAFTS; A5 sends nothing until a message is `approved`.
# These admin-gated actions are the ONLY way a draft becomes sendable. Sending
# still happens in the pipeline worker (which owns suppression/window/limits)
# and physically goes out through N8N — the board never sends directly.
# --------------------------------------------------------------------------- #
async def _get_message_or_404(message_id: int):
    msg = await prisma.messages.find_unique(where={"id": message_id})
    if msg is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Message not found")
    return msg


async def _domain_slug_for_message(msg) -> str:
    lead = await prisma.leads.find_unique(where={"id": msg.lead_id})
    if lead is None:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Message has no lead")
    dom = await prisma.domains.find_unique(where={"id": lead.domain_id})
    if dom is None:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Lead has no domain")
    return dom.slug


@router.patch("/{message_id}", response_model=MessageOut)
async def edit_message(
    message_id: int,
    edit: MessageEdit,
    user=Depends(require_admin),
) -> MessageOut:
    """Edit a draft's subject/body before it goes out.

    Editable while drafted/approved/rejected/failed — never once queued or sent.
    Editing an APPROVED message resets it to DRAFTED: what a human approved must
    be exactly what is sent, so any change re-enters the approval gate.
    """
    msg = await _get_message_or_404(message_id)
    if msg.status in {"queued", "sent"}:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Cannot edit a '{msg.status}' message",
        )

    data: dict[str, Any] = {}
    if edit.subject is not None:
        if not edit.subject.strip():
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Subject cannot be empty")
        data["subject"] = edit.subject.strip()
    if edit.subject_b is not None:
        data["subject_b"] = edit.subject_b.strip() or None
    if edit.body is not None:
        if not edit.body.strip():
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Body cannot be empty")
        data["body"] = edit.body.strip()
    if not data:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Nothing to update")

    # Any edit re-enters the approval gate.
    data.update({"status": "drafted", "approved_at": None, "approved_by": None,
                 "error": f"edited by {user.email}" if msg.status == "approved" else msg.error})
    updated = await prisma.messages.update(where={"id": message_id}, data=data)
    return MessageOut.model_validate(updated)


@router.post("/{message_id}/approve", response_model=MessageOut)
async def approve_message(message_id: int, user=Depends(require_admin)) -> MessageOut:
    """Clear a draft to send. Does not send — A5 sends approved messages."""
    msg = await _get_message_or_404(message_id)
    if msg.status not in {"drafted", "rejected", "failed"}:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Cannot approve a '{msg.status}' message",
        )
    updated = await prisma.messages.update(
        where={"id": message_id},
        data={
            "status": "approved",
            "approved_at": datetime.now(timezone.utc),
            "approved_by": user.email,
            "error": None,
        },
    )
    return MessageOut.model_validate(updated)


@router.post("/{message_id}/reject", response_model=MessageOut)
async def reject_message(
    message_id: int,
    user=Depends(require_admin),
    reason: str | None = Body(None, embed=True),
) -> MessageOut:
    """Decline a draft — it is never sent."""
    msg = await _get_message_or_404(message_id)
    if msg.status == "sent":
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST, detail="Cannot reject a sent message"
        )
    updated = await prisma.messages.update(
        where={"id": message_id},
        data={"status": "rejected", "error": reason or f"rejected by {user.email}"},
    )
    return MessageOut.model_validate(updated)


@router.post("/{message_id}/send")
async def send_message(message_id: int, user=Depends(require_admin)) -> dict:
    """Individual send: approve this message (if needed) and dispatch it now.

    Enqueues a `send` run targeting THIS message; the pipeline worker's A5
    sends only it, via N8N, honouring suppression/verify gates. Returns the
    send run id so the caller can follow it on the board.
    """
    msg = await _get_message_or_404(message_id)
    if msg.status == "sent":
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Already sent")

    data: dict[str, Any] = {"status": "approved", "error": None}
    if msg.status != "approved":
        data["approved_at"] = datetime.now(timezone.utc)
        data["approved_by"] = user.email
    await prisma.messages.update(where={"id": message_id}, data=data)

    slug = await _domain_slug_for_message(msg)
    run_id = await runner.start_run(domain_slug=slug, mode="send", stage=str(message_id))
    return {"message_id": message_id, "status": "approved", "send_run_id": run_id}
