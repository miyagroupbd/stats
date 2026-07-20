"""Leads router — CRUD, filtering/search, CSV import, and per-lead message history.

Every route requires an authenticated user. Writes (create/update/delete/import)
additionally require an admin role. Domains are addressed by slug or numeric id
via the ?domain= query param.
"""
from __future__ import annotations

import csv
import io
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, File, HTTPException, Query, Response, UploadFile, status

from app.core.db import prisma
from app.deps import get_current_user, require_admin
from app.schemas.lead import (
    LeadCreate,
    LeadImportResult,
    LeadOut,
    LeadUpdate,
)
from app.schemas.message import MessageOut

router = APIRouter(prefix="/leads", tags=["leads"])


# --------------------------------------------------------------------------- #
# Allowed string vocabularies (enum columns are plain VARCHAR in the DB)
# --------------------------------------------------------------------------- #
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
LEAD_SOURCES = ("apollo", "scrape", "manual", "import", "hunter", "snov")
PRIORITIES = ("hot", "warm", "cool", "cold")


# --------------------------------------------------------------------------- #
# Helpers
# --------------------------------------------------------------------------- #
async def _resolve_domain(domain: str):
    """Resolve a ?domain= value that may be a slug OR a numeric id. 404 if missing."""
    found = await prisma.domains.find_unique(where={"slug": domain})
    if found is None and domain.isdigit():
        found = await prisma.domains.find_unique(where={"id": int(domain)})
    if found is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=f"Domain '{domain}' not found")
    return found


def _parse_choice(allowed: tuple[str, ...], value: str, field: str) -> str:
    """Validate a string against the allowed set; 400 with the valid set on failure."""
    if value not in allowed:
        valid = ", ".join(allowed)
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Invalid {field} '{value}'. Valid values: {valid}",
        )
    return value


async def _get_lead_or_404(lead_id: int):
    lead = await prisma.leads.find_unique(where={"id": lead_id})
    if lead is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=f"Lead {lead_id} not found")
    return lead


async def _validate_campaign(campaign_id: int, domain_id: int) -> None:
    """Ensure campaign_id exists and belongs to the lead's domain. 404/400 otherwise."""
    campaign = await prisma.campaigns.find_unique(where={"id": campaign_id})
    if campaign is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=f"Campaign {campaign_id} not found")
    if campaign.domain_id != domain_id:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Campaign {campaign_id} does not belong to this lead's domain",
        )


async def _upsert_lead(domain_id: int, email: str, fields: dict) -> tuple[object, bool]:
    """Insert a lead or update the existing (domain_id, email). Returns (lead, created).

    On update only non-None values overwrite, so pipeline-state columns survive.
    """
    existing = await prisma.leads.find_first(where={"domain_id": domain_id, "email": email})
    data = {key: value for key, value in fields.items() if value is not None}

    if existing is None:
        payload = {
            "domain_id": domain_id,
            "email": email,
            "status": "new",
            "source": "manual",
            "verify_status": "unverified",
            "follow_up_count": 0,
        }
        payload.update(data)
        return await prisma.leads.create(data=payload), True

    data["updated_at"] = datetime.now(timezone.utc)
    updated = await prisma.leads.update(where={"id": existing.id}, data=data)
    return updated, False


# --------------------------------------------------------------------------- #
# List / search
# --------------------------------------------------------------------------- #
@router.get("/")
async def list_leads(
    domain: str | None = Query(None, description="Domain slug or numeric id; omit for all domains"),
    status_: str | None = Query(None, alias="status"),
    priority: str | None = Query(None),
    q: str | None = Query(None, description="ILIKE on email/company/first_name/last_name"),
    limit: int = Query(50, ge=1, le=500),
    offset: int = Query(0, ge=0),
    user=Depends(get_current_user),
) -> dict:
    # No ?domain= means "every domain". The dashboard counts leads across all
    # arms, so a leads page locked to one arm reported 0 while the dashboard
    # showed 25 — the same data, filtered differently.
    where: dict = {}
    if domain is not None:
        dom = await _resolve_domain(domain)
        where["domain_id"] = dom.id
    if status_ is not None:
        where["status"] = _parse_choice(LEAD_STATUSES, status_, "status")
    if priority is not None:
        where["priority"] = _parse_choice(PRIORITIES, priority, "priority")
    if q:
        where["OR"] = [
            {"email": {"contains": q, "mode": "insensitive"}},
            {"company": {"contains": q, "mode": "insensitive"}},
            {"first_name": {"contains": q, "mode": "insensitive"}},
            {"last_name": {"contains": q, "mode": "insensitive"}},
        ]

    total = await prisma.leads.count(where=where)
    rows = await prisma.leads.find_many(
        where=where, order={"id": "desc"}, take=limit, skip=offset
    )
    items = [LeadOut.model_validate(row) for row in rows]
    return {"items": items, "total": total, "limit": limit, "offset": offset}


# --------------------------------------------------------------------------- #
# Read one
# --------------------------------------------------------------------------- #
@router.get("/{lead_id}", response_model=LeadOut)
async def get_lead(
    lead_id: int,
    user=Depends(get_current_user),
) -> LeadOut:
    return LeadOut.model_validate(await _get_lead_or_404(lead_id))


# --------------------------------------------------------------------------- #
# Create (upsert on domain_id + email)
# --------------------------------------------------------------------------- #
@router.post("/", response_model=LeadOut, status_code=status.HTTP_201_CREATED)
async def create_lead(
    payload: LeadCreate,
    response: Response,
    domain: str = Query(..., description="Domain slug or numeric id"),
    admin=Depends(require_admin),
) -> LeadOut:
    dom = await _resolve_domain(domain)

    fields = payload.model_dump(exclude={"email"})
    fields["source"] = _parse_choice(LEAD_SOURCES, fields.get("source") or "manual", "source")

    if fields.get("campaign_id") is not None:
        await _validate_campaign(fields["campaign_id"], dom.id)

    lead, created = await _upsert_lead(dom.id, payload.email, fields)
    if not created:
        response.status_code = status.HTTP_200_OK
    return LeadOut.model_validate(lead)


# --------------------------------------------------------------------------- #
# Update
# --------------------------------------------------------------------------- #
@router.patch("/{lead_id}", response_model=LeadOut)
async def update_lead(
    lead_id: int,
    payload: LeadUpdate,
    admin=Depends(require_admin),
) -> LeadOut:
    lead = await _get_lead_or_404(lead_id)

    data = payload.model_dump(exclude_unset=True)
    if data.get("status") is not None:
        data["status"] = _parse_choice(LEAD_STATUSES, data["status"], "status")
    if data.get("campaign_id") is not None:
        await _validate_campaign(data["campaign_id"], lead.domain_id)

    data["updated_at"] = datetime.now(timezone.utc)
    updated = await prisma.leads.update(where={"id": lead.id}, data=data)
    return LeadOut.model_validate(updated if updated is not None else lead)


# --------------------------------------------------------------------------- #
# Delete
# --------------------------------------------------------------------------- #
@router.delete("/{lead_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_lead(
    lead_id: int,
    admin=Depends(require_admin),
) -> None:
    lead = await _get_lead_or_404(lead_id)
    await prisma.leads.delete(where={"id": lead.id})


# --------------------------------------------------------------------------- #
# CSV import
# --------------------------------------------------------------------------- #
_IMPORT_STR_FIELDS = (
    "first_name",
    "last_name",
    "title",
    "company",
    "company_domain",
    "industry",
    "country",
)


@router.post("/import", response_model=LeadImportResult)
async def import_leads(
    domain: str = Query(..., description="Domain slug or numeric id"),
    file: UploadFile = File(..., description="CSV with email,first_name,last_name,title,company,company_domain,industry,country,employee_count"),
    admin=Depends(require_admin),
) -> LeadImportResult:
    dom = await _resolve_domain(domain)

    raw = await file.read()
    try:
        text = raw.decode("utf-8-sig")
    except UnicodeDecodeError:
        text = raw.decode("latin-1")

    reader = csv.DictReader(io.StringIO(text))
    created = updated = skipped = 0
    errors: list[str] = []

    for line_no, row in enumerate(reader, start=2):  # header is line 1
        email = (row.get("email") or "").strip()
        if "@" not in email:
            skipped += 1
            continue

        fields: dict = {"source": "import"}
        for key in _IMPORT_STR_FIELDS:
            val = (row.get(key) or "").strip()
            if val:
                fields[key] = val

        ec = (row.get("employee_count") or "").strip()
        if ec:
            try:
                fields["employee_count"] = int(ec)
            except ValueError:
                errors.append(f"row {line_no}: invalid employee_count {ec!r}")

        # each upsert commits on its own, so a duplicate email later in the same
        # file updates the row written moments ago instead of colliding
        _, was_created = await _upsert_lead(dom.id, email, fields)
        if was_created:
            created += 1
        else:
            updated += 1

    return LeadImportResult(created=created, updated=updated, skipped=skipped, errors=errors)


# --------------------------------------------------------------------------- #
# Per-lead message history
# --------------------------------------------------------------------------- #
@router.get("/{lead_id}/messages", response_model=list[MessageOut])
async def lead_messages(
    lead_id: int,
    user=Depends(get_current_user),
) -> list[MessageOut]:
    await _get_lead_or_404(lead_id)
    rows = await prisma.messages.find_many(where={"lead_id": lead_id}, order={"id": "asc"})
    return [MessageOut.model_validate(row) for row in rows]
