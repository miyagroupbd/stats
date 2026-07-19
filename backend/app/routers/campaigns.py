"""Campaigns router — per-domain campaign CRUD + lead counts for the dashboard.

Campaigns are scoped to a domain (business arm). Reads are open to any
authenticated user; writes (create / update / delete) require an admin role.
The ``?domain=`` query accepts either a domain slug or a numeric id.
"""
from __future__ import annotations

from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, Query, Response, status

from app.core.db import prisma
from app.deps import get_current_user, require_admin
from app.schemas.campaign import CampaignCreate, CampaignOut, CampaignUpdate

router = APIRouter(prefix="/campaigns", tags=["campaigns"])

CAMPAIGN_STATUSES = ("draft", "active", "paused", "completed")


async def _resolve_domain(domain: str):
    """Resolve a ``?domain=`` value that may be a slug or a numeric id. 404 if missing."""
    found = await prisma.domains.find_unique(where={"slug": domain})
    if found is None and domain.isdigit():
        found = await prisma.domains.find_unique(where={"id": int(domain)})
    if found is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail=f"Domain not found: {domain}"
        )
    return found


async def _lead_count(campaign_id: int) -> int:
    return await prisma.leads.count(where={"campaign_id": campaign_id})


@router.get("/", response_model=list[CampaignOut])
async def list_campaigns(
    domain: str = Query(..., description="Domain slug or numeric id"),
    _=Depends(get_current_user),
) -> list[CampaignOut]:
    dom = await _resolve_domain(domain)
    campaigns = await prisma.campaigns.find_many(where={"domain_id": dom.id})
    out: list[CampaignOut] = []
    for campaign in campaigns:
        item = CampaignOut.model_validate(campaign)
        item.lead_count = await _lead_count(campaign.id)
        out.append(item)
    return out


@router.post("/", response_model=CampaignOut, status_code=status.HTTP_201_CREATED)
async def create_campaign(
    payload: CampaignCreate,
    domain: str = Query(..., description="Domain slug or numeric id"),
    _=Depends(require_admin),
) -> CampaignOut:
    dom = await _resolve_domain(domain)
    campaign = await prisma.campaigns.create(
        data={
            "domain_id": dom.id,
            "name": payload.name,
            "description": payload.description,
            "status": "draft",
        }
    )
    item = CampaignOut.model_validate(campaign)
    item.lead_count = 0
    return item


@router.patch("/{campaign_id}", response_model=CampaignOut)
async def update_campaign(
    campaign_id: int,
    payload: CampaignUpdate,
    _=Depends(require_admin),
) -> CampaignOut:
    campaign = await prisma.campaigns.find_unique(where={"id": campaign_id})
    if campaign is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail=f"Campaign not found: {campaign_id}"
        )
    data = payload.model_dump(exclude_unset=True)
    if "status" in data and data["status"] is not None:
        raw = data["status"]
        if raw not in CAMPAIGN_STATUSES:
            valid = ", ".join(CAMPAIGN_STATUSES)
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"Invalid status '{raw}'. Valid: {valid}",
            )
    if data:
        data["updated_at"] = datetime.now(timezone.utc)
        campaign = await prisma.campaigns.update(where={"id": campaign_id}, data=data)
    item = CampaignOut.model_validate(campaign)
    item.lead_count = await _lead_count(campaign_id)
    return item


@router.delete("/{campaign_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_campaign(
    campaign_id: int,
    _=Depends(require_admin),
) -> Response:
    campaign = await prisma.campaigns.find_unique(where={"id": campaign_id})
    if campaign is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail=f"Campaign not found: {campaign_id}"
        )
    await prisma.campaigns.delete(where={"id": campaign_id})
    return Response(status_code=status.HTTP_204_NO_CONTENT)
