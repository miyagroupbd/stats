"""Leads router — CRUD, filtering/search, CSV import, and per-lead message history.

Every route requires an authenticated user. Writes (create/update/delete/import)
additionally require an admin role. Domains are addressed by slug or numeric id
via the ?domain= query param.
"""
from __future__ import annotations

import csv
import io

from fastapi import APIRouter, Depends, File, HTTPException, Query, Response, UploadFile, status
from sqlalchemy import func, or_, select
from sqlalchemy.orm import Session

from app.deps import get_current_user, get_db, require_admin
from app.schemas.lead import (
    LeadCreate,
    LeadImportResult,
    LeadOut,
    LeadUpdate,
)
from app.schemas.message import MessageOut
from app.db.enums import LeadSource, LeadStatus, Priority
from app.db.models import Domain, Lead, Message
from app.db.repos import campaigns as campaigns_repo
from app.db.repos import domains as domains_repo
from app.db.repos import leads as leads_repo

router = APIRouter(prefix="/leads", tags=["leads"])


# --------------------------------------------------------------------------- #
# Helpers
# --------------------------------------------------------------------------- #
def _resolve_domain(db: Session, domain: str) -> Domain:
    """Resolve a ?domain= value that may be a slug OR a numeric id. 404 if missing."""
    found = domains_repo.get_by_slug(db, domain)
    if found is None and domain.isdigit():
        found = domains_repo.get(db, int(domain))
    if found is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=f"Domain '{domain}' not found")
    return found


def _parse_enum(enum_cls, value: str, field: str):
    """Validate a string against a str-enum; 400 with the valid set on failure."""
    try:
        return enum_cls(value)
    except ValueError:
        valid = ", ".join(m.value for m in enum_cls)
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Invalid {field} '{value}'. Valid values: {valid}",
        )


def _get_lead_or_404(db: Session, lead_id: int) -> Lead:
    lead = leads_repo.get(db, lead_id)
    if lead is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=f"Lead {lead_id} not found")
    return lead


def _validate_campaign(db: Session, campaign_id: int, domain_id: int) -> None:
    """Ensure campaign_id exists and belongs to the lead's domain. 404/400 otherwise."""
    campaign = campaigns_repo.get(db, campaign_id)
    if campaign is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=f"Campaign {campaign_id} not found")
    if campaign.domain_id != domain_id:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Campaign {campaign_id} does not belong to this lead's domain",
        )


# --------------------------------------------------------------------------- #
# List / search
# --------------------------------------------------------------------------- #
@router.get("/")
def list_leads(
    domain: str = Query(..., description="Domain slug or numeric id"),
    status_: str | None = Query(None, alias="status"),
    priority: str | None = Query(None),
    q: str | None = Query(None, description="ILIKE on email/company/first_name/last_name"),
    limit: int = Query(50, ge=1, le=500),
    offset: int = Query(0, ge=0),
    db: Session = Depends(get_db),
    user=Depends(get_current_user),
) -> dict:
    dom = _resolve_domain(db, domain)

    conditions = [Lead.domain_id == dom.id]
    if status_ is not None:
        conditions.append(Lead.status == _parse_enum(LeadStatus, status_, "status"))
    if priority is not None:
        conditions.append(Lead.priority == _parse_enum(Priority, priority, "priority"))
    if q:
        escaped = q.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")
        pattern = f"%{escaped}%"
        conditions.append(
            or_(
                Lead.email.ilike(pattern, escape="\\"),
                Lead.company.ilike(pattern, escape="\\"),
                Lead.first_name.ilike(pattern, escape="\\"),
                Lead.last_name.ilike(pattern, escape="\\"),
            )
        )

    total = db.scalar(select(func.count()).select_from(Lead).where(*conditions)) or 0
    rows = db.scalars(
        select(Lead).where(*conditions).order_by(Lead.id.desc()).limit(limit).offset(offset)
    )
    items = [LeadOut.model_validate(row) for row in rows]
    return {"items": items, "total": total, "limit": limit, "offset": offset}


# --------------------------------------------------------------------------- #
# Read one
# --------------------------------------------------------------------------- #
@router.get("/{lead_id}", response_model=LeadOut)
def get_lead(
    lead_id: int,
    db: Session = Depends(get_db),
    user=Depends(get_current_user),
) -> LeadOut:
    return LeadOut.model_validate(_get_lead_or_404(db, lead_id))


# --------------------------------------------------------------------------- #
# Create (upsert on domain_id + email)
# --------------------------------------------------------------------------- #
@router.post("/", response_model=LeadOut, status_code=status.HTTP_201_CREATED)
def create_lead(
    payload: LeadCreate,
    response: Response,
    domain: str = Query(..., description="Domain slug or numeric id"),
    db: Session = Depends(get_db),
    admin=Depends(require_admin),
) -> LeadOut:
    dom = _resolve_domain(db, domain)

    fields = payload.model_dump(exclude={"email"})
    fields["source"] = _parse_enum(LeadSource, fields.get("source") or "manual", "source")

    if fields.get("campaign_id") is not None:
        _validate_campaign(db, fields["campaign_id"], dom.id)

    lead, created = leads_repo.upsert(db, dom.id, payload.email, **fields)
    db.commit()
    db.refresh(lead)
    if not created:
        response.status_code = status.HTTP_200_OK
    return LeadOut.model_validate(lead)


# --------------------------------------------------------------------------- #
# Update
# --------------------------------------------------------------------------- #
@router.patch("/{lead_id}", response_model=LeadOut)
def update_lead(
    lead_id: int,
    payload: LeadUpdate,
    db: Session = Depends(get_db),
    admin=Depends(require_admin),
) -> LeadOut:
    lead = _get_lead_or_404(db, lead_id)

    data = payload.model_dump(exclude_unset=True)
    if data.get("status") is not None:
        data["status"] = _parse_enum(LeadStatus, data["status"], "status")
    if data.get("campaign_id") is not None:
        _validate_campaign(db, data["campaign_id"], lead.domain_id)

    for key, value in data.items():
        setattr(lead, key, value)

    db.commit()
    db.refresh(lead)
    return LeadOut.model_validate(lead)


# --------------------------------------------------------------------------- #
# Delete
# --------------------------------------------------------------------------- #
@router.delete("/{lead_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_lead(
    lead_id: int,
    db: Session = Depends(get_db),
    admin=Depends(require_admin),
) -> None:
    lead = _get_lead_or_404(db, lead_id)
    db.delete(lead)
    db.commit()


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
    db: Session = Depends(get_db),
    admin=Depends(require_admin),
) -> LeadImportResult:
    dom = _resolve_domain(db, domain)

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

        fields: dict = {"source": LeadSource.IMPORT}
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

        _, was_created = leads_repo.upsert(db, dom.id, email, **fields)
        db.flush()  # so a duplicate email later in the same file updates instead of colliding
        if was_created:
            created += 1
        else:
            updated += 1

    db.commit()
    return LeadImportResult(created=created, updated=updated, skipped=skipped, errors=errors)


# --------------------------------------------------------------------------- #
# Per-lead message history
# --------------------------------------------------------------------------- #
@router.get("/{lead_id}/messages", response_model=list[MessageOut])
def lead_messages(
    lead_id: int,
    db: Session = Depends(get_db),
    user=Depends(get_current_user),
) -> list[MessageOut]:
    _get_lead_or_404(db, lead_id)
    rows = db.scalars(select(Message).where(Message.lead_id == lead_id).order_by(Message.id))
    return [MessageOut.model_validate(row) for row in rows]
