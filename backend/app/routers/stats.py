"""Stats router — dashboard aggregate + per-domain rollups (async Prisma).

Read-only endpoints (every route requires an authenticated user). No writes,
so no require_admin here. Lead counts are per-status ``leads.count`` queries
keyed by the lead-status vocabulary, sent-message totals come from a
``messages.count`` on status="sent", and recent activity from ``runs``.
"""
from __future__ import annotations

import asyncio
from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends, HTTPException, status

from app.core.db import prisma
from app.deps import get_current_user
from app.schemas.run import RunOut
from app.schemas.stats import DomainStat, Overview

router = APIRouter(prefix="/stats", tags=["stats"])

LEAD_STATUSES = (
    "new",
    "qualified",
    "queued",
    "contacted",
    "replied",
    "bounced",
    "converted",
    "dead",
    "suppressed",
)


def _reply_rate(replied: int, contacted: int) -> float:
    return round(replied / contacted, 3) if contacted else 0.0


async def _counts_by_status(domain_id: int) -> dict[str, int]:
    """{status: n} for one domain, omitting statuses with no rows (matches the
    old GROUP BY shape so the dashboard's status_breakdown is unchanged)."""
    totals = await asyncio.gather(
        *(
            prisma.leads.count(where={"domain_id": domain_id, "status": s})
            for s in LEAD_STATUSES
        )
    )
    return {s: n for s, n in zip(LEAD_STATUSES, totals) if n}


@router.get("/overview", response_model=Overview)
async def overview(_user=Depends(get_current_user)) -> Overview:
    all_domains = await prisma.domains.find_many(order={"slug": "asc"})

    per_domain: list[DomainStat] = []
    status_breakdown: dict[str, int] = {}
    total_leads = 0
    total_contacted = 0
    total_replied = 0
    total_bounced = 0

    for d in all_domains:
        counts = await _counts_by_status(d.id)
        d_total = sum(counts.values())
        contacted = counts.get("contacted", 0)
        replied = counts.get("replied", 0)
        bounced = counts.get("bounced", 0)

        per_domain.append(
            DomainStat(
                slug=d.slug,
                name=d.name,
                is_active=d.is_active,
                total_leads=d_total,
                contacted=contacted,
                replied=replied,
                bounced=bounced,
                reply_rate=_reply_rate(replied, contacted),
            )
        )

        for key, n in counts.items():
            status_breakdown[key] = status_breakdown.get(key, 0) + n

        total_leads += d_total
        total_contacted += contacted
        total_replied += replied
        total_bounced += bounced

    messages_sent = await prisma.messages.count(where={"status": "sent"})

    cutoff = datetime.now(timezone.utc) - timedelta(days=7)
    runs_recent = await prisma.runs.count(where={"started_at": {"gte": cutoff}})

    return Overview(
        domains=len(all_domains),
        active_domains=sum(1 for d in all_domains if d.is_active),
        total_leads=total_leads,
        total_contacted=total_contacted,
        total_replied=total_replied,
        total_bounced=total_bounced,
        messages_sent=messages_sent,
        runs_recent=runs_recent,
        reply_rate=_reply_rate(total_replied, total_contacted),
        per_domain=per_domain,
        status_breakdown=status_breakdown,
    )


@router.get("/domain/{slug}")
async def domain_stats(slug: str, _user=Depends(get_current_user)) -> dict:
    domain = await prisma.domains.find_unique(where={"slug": slug})
    if domain is None and slug.isdigit():
        domain = await prisma.domains.find_unique(where={"id": int(slug)})
    if domain is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Domain not found")

    counts = await _counts_by_status(domain.id)
    total = sum(counts.values())
    contacted = counts.get("contacted", 0)
    replied = counts.get("replied", 0)
    bounced = counts.get("bounced", 0)

    recent = await prisma.runs.find_many(
        where={"domain_id": domain.id}, order={"id": "desc"}, take=10
    )

    return {
        "slug": domain.slug,
        "name": domain.name,
        "is_active": domain.is_active,
        "total_leads": total,
        "contacted": contacted,
        "replied": replied,
        "bounced": bounced,
        "reply_rate": _reply_rate(replied, contacted),
        "bounce_rate": round(bounced / contacted, 3) if contacted else 0.0,
        "status_breakdown": counts,
        "recent_runs": [RunOut.model_validate(r).model_dump(mode="json") for r in recent],
    }
