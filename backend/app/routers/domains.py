"""Domains router — CRUD for business-arm sending domains.

Reads are open to any authenticated user; writes/deletes require an admin.
The SMTP password is write-only: it is encrypted at rest (smtp_pass_enc) and
never returned. DomainOut exposes a derived `smtp_configured` flag instead.
"""
from __future__ import annotations

from datetime import datetime, timezone
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, status
from prisma import Json

from app.core.db import prisma
from app.core.security import encrypt
from app.deps import get_current_user, require_admin
from app.schemas.domain import DomainCreate, DomainOut, DomainUpdate

router = APIRouter(prefix="/domains", tags=["domains"])

ADMIN_ROLES = ("admin", "superadmin")

# Columns stored as JSONB — values must be wrapped for Prisma writes.
_JSON_FIELDS = ("icp_segments", "send_days")


def _to_out(domain, *, is_admin: bool) -> DomainOut:
    """Build a DomainOut, deriving smtp_configured and never leaking the password.

    Mailbox login details are masked from non-admin viewers.
    """
    out = DomainOut.model_validate(domain)
    out.smtp_configured = bool(domain.smtp_user and domain.smtp_pass_enc)
    if not is_admin:
        out.smtp_user = None
    return out


def _is_admin(user) -> bool:
    return user.role in ADMIN_ROLES


def _wrap_json(data: dict[str, Any]) -> dict[str, Any]:
    """Wrap JSONB-backed values so Prisma serialises them correctly."""
    for key in _JSON_FIELDS:
        if key in data and data[key] is not None:
            data[key] = Json(data[key])
    return data


@router.get("/", response_model=list[DomainOut])
async def list_domains(
    user=Depends(get_current_user),
) -> list[DomainOut]:
    admin = _is_admin(user)
    domains = await prisma.domains.find_many(order={"slug": "asc"})
    return [_to_out(d, is_admin=admin) for d in domains]


@router.get("/{slug}", response_model=DomainOut)
async def get_domain(
    slug: str,
    user=Depends(get_current_user),
) -> DomainOut:
    domain = await prisma.domains.find_unique(where={"slug": slug})
    if domain is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Domain not found")
    return _to_out(domain, is_admin=_is_admin(user))


@router.post("/", response_model=DomainOut, status_code=status.HTTP_201_CREATED)
async def create_domain(
    payload: DomainCreate,
    _admin=Depends(require_admin),
) -> DomainOut:
    existing = await prisma.domains.find_unique(where={"slug": payload.slug})
    if existing is not None:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=f"Domain with slug '{payload.slug}' already exists",
        )
    data = payload.model_dump(exclude={"smtp_password"})
    if payload.smtp_password:
        data["smtp_pass_enc"] = encrypt(payload.smtp_password)
    domain = await prisma.domains.create(data=_wrap_json(data))
    return _to_out(domain, is_admin=True)


@router.patch("/{slug}", response_model=DomainOut)
async def update_domain(
    slug: str,
    payload: DomainUpdate,
    _admin=Depends(require_admin),
) -> DomainOut:
    domain = await prisma.domains.find_unique(where={"slug": slug})
    if domain is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Domain not found")
    data = payload.model_dump(exclude_unset=True)
    smtp_password = data.pop("smtp_password", None)
    if "smtp_password" in payload.model_fields_set:
        # Present (even if None) => caller intends to change it; omission keeps current.
        data["smtp_pass_enc"] = encrypt(smtp_password)
    data["updated_at"] = datetime.now(timezone.utc)
    updated = await prisma.domains.update(where={"id": domain.id}, data=_wrap_json(data))
    if updated is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Domain not found")
    return _to_out(updated, is_admin=True)


@router.delete("/{slug}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_domain(
    slug: str,
    _admin=Depends(require_admin),
) -> None:
    domain = await prisma.domains.find_unique(where={"slug": slug})
    if domain is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Domain not found")
    await prisma.domains.delete(where={"id": domain.id})
