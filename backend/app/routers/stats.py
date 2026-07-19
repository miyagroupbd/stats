"""Stats router — dashboard aggregate + per-domain rollups.

Read-only endpoints (every route requires an authenticated user). No writes,
so no require_admin and no db.commit() here. Lead counts come from
leads_repo.counts_by_status (keys are LeadStatus values), sent-message totals
from a direct Message aggregate, and recent activity from runs_repo.recent.
"""
from __future__ import annotations

from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.deps import get_current_user, get_db
from app.schemas.run import RunOut
from app.schemas.stats import DomainStat, Overview
from app.db.enums import MessageStatus
from app.db.models import Message, Run
from app.db.repos import domains as domains_repo
from app.db.repos import leads as leads_repo
from app.db.repos import runs as runs_repo

router = APIRouter(prefix="/stats", tags=["stats"])


def _reply_rate(replied: int, contacted: int) -> float:
    return round(replied / contacted, 3) if contacted else 0.0


@router.get("/overview", response_model=Overview)
def overview(
    db: Session = Depends(get_db),
    _user=Depends(get_current_user),
) -> Overview:
    all_domains = domains_repo.list_all(db)

    per_domain: list[DomainStat] = []
    status_breakdown: dict[str, int] = {}
    total_leads = 0
    total_contacted = 0
    total_replied = 0
    total_bounced = 0

    for d in all_domains:
        counts = leads_repo.counts_by_status(db, d.id)  # {LeadStatus.value: n}
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

    messages_sent = db.scalar(
        select(func.count(Message.id)).where(Message.status == MessageStatus.SENT)
    ) or 0

    cutoff = datetime.now(timezone.utc) - timedelta(days=7)
    runs_recent = db.scalar(
        select(func.count(Run.id)).where(Run.started_at >= cutoff)
    ) or 0

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
def domain_stats(
    slug: str,
    db: Session = Depends(get_db),
    _user=Depends(get_current_user),
) -> dict:
    domain = domains_repo.get_by_slug(db, slug)
    if domain is None and slug.isdigit():
        domain = domains_repo.get(db, int(slug))
    if domain is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Domain not found")

    counts = leads_repo.counts_by_status(db, domain.id)  # {LeadStatus.value: n}
    total = sum(counts.values())
    contacted = counts.get("contacted", 0)
    replied = counts.get("replied", 0)
    bounced = counts.get("bounced", 0)

    recent = runs_repo.recent(db, domain_id=domain.id, limit=10)

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
