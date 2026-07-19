"""Campaigns router — per-domain campaign CRUD + lead counts for the dashboard.

Campaigns are scoped to a domain (business arm). Reads are open to any
authenticated user; writes (create / update / delete) require an admin role.
The ``?domain=`` query accepts either a domain slug or a numeric id.
"""
from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Query, Response, status
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.deps import get_current_user, get_db, require_admin
from app.schemas.campaign import CampaignCreate, CampaignOut, CampaignUpdate
from app.db.enums import CampaignStatus
from app.db.models import Campaign, Domain, Lead, User
from app.db.repos import campaigns as campaigns_repo
from app.db.repos import domains as domains_repo

router = APIRouter(prefix="/campaigns", tags=["campaigns"])


def _resolve_domain(db: Session, domain: str) -> Domain:
    """Resolve a ``?domain=`` value that may be a slug or a numeric id. 404 if missing."""
    found = domains_repo.get_by_slug(db, domain)
    if found is None and domain.isdigit():
        found = domains_repo.get(db, int(domain))
    if found is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail=f"Domain not found: {domain}"
        )
    return found


def _lead_count(db: Session, campaign_id: int) -> int:
    return db.scalar(select(func.count(Lead.id)).where(Lead.campaign_id == campaign_id)) or 0


@router.get("/", response_model=list[CampaignOut])
def list_campaigns(
    domain: str = Query(..., description="Domain slug or numeric id"),
    db: Session = Depends(get_db),
    _: User = Depends(get_current_user),
) -> list[CampaignOut]:
    dom = _resolve_domain(db, domain)
    out: list[CampaignOut] = []
    for campaign in campaigns_repo.list_for_domain(db, dom.id):
        item = CampaignOut.model_validate(campaign)
        item.lead_count = _lead_count(db, campaign.id)
        out.append(item)
    return out


@router.post("/", response_model=CampaignOut, status_code=status.HTTP_201_CREATED)
def create_campaign(
    payload: CampaignCreate,
    domain: str = Query(..., description="Domain slug or numeric id"),
    db: Session = Depends(get_db),
    _: User = Depends(require_admin),
) -> CampaignOut:
    dom = _resolve_domain(db, domain)
    campaign = campaigns_repo.create(
        db, domain_id=dom.id, name=payload.name, description=payload.description
    )
    db.commit()
    db.refresh(campaign)
    item = CampaignOut.model_validate(campaign)
    item.lead_count = 0
    return item


@router.patch("/{campaign_id}", response_model=CampaignOut)
def update_campaign(
    campaign_id: int,
    payload: CampaignUpdate,
    db: Session = Depends(get_db),
    _: User = Depends(require_admin),
) -> CampaignOut:
    campaign = campaigns_repo.get(db, campaign_id)
    if campaign is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail=f"Campaign not found: {campaign_id}"
        )
    data = payload.model_dump(exclude_unset=True)
    if "status" in data and data["status"] is not None:
        raw = data["status"]
        try:
            data["status"] = CampaignStatus(raw)
        except ValueError:
            valid = ", ".join(s.value for s in CampaignStatus)
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"Invalid status '{raw}'. Valid: {valid}",
            )
    for field, value in data.items():
        setattr(campaign, field, value)
    db.commit()
    db.refresh(campaign)
    item = CampaignOut.model_validate(campaign)
    item.lead_count = _lead_count(db, campaign.id)
    return item


@router.delete("/{campaign_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_campaign(
    campaign_id: int,
    db: Session = Depends(get_db),
    _: User = Depends(require_admin),
) -> Response:
    campaign = campaigns_repo.get(db, campaign_id)
    if campaign is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail=f"Campaign not found: {campaign_id}"
        )
    db.delete(campaign)
    db.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)
