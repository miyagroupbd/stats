"""Domains router — CRUD for business-arm sending domains.

Reads are open to any authenticated user; writes/deletes require an admin.
The SMTP password is write-only: it is encrypted at rest (smtp_pass_enc) and
never returned. DomainOut exposes a derived `smtp_configured` flag instead.
"""
from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from app.deps import get_current_user, get_db, require_admin
from app.schemas.domain import DomainCreate, DomainOut, DomainUpdate
from app.db.enums import UserRole
from app.db.models import Domain, User
from app.db.repos import domains as domains_repo

router = APIRouter(prefix="/domains", tags=["domains"])


def _to_out(domain: Domain, *, is_admin: bool) -> DomainOut:
    """Build a DomainOut, deriving smtp_configured and never leaking the password.

    Mailbox login details are masked from non-admin viewers.
    """
    out = DomainOut.model_validate(domain)
    out.smtp_configured = bool(domain.smtp_user and domain.smtp_pass_enc)
    if not is_admin:
        out.smtp_user = None
    return out


def _is_admin(user: User) -> bool:
    return user.role in (UserRole.ADMIN, UserRole.SUPERADMIN)


@router.get("/", response_model=list[DomainOut])
def list_domains(
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> list[DomainOut]:
    admin = _is_admin(user)
    return [_to_out(d, is_admin=admin) for d in domains_repo.list_all(db)]


@router.get("/{slug}", response_model=DomainOut)
def get_domain(
    slug: str,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> DomainOut:
    domain = domains_repo.get_by_slug(db, slug)
    if domain is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Domain not found")
    return _to_out(domain, is_admin=_is_admin(user))


@router.post("/", response_model=DomainOut, status_code=status.HTTP_201_CREATED)
def create_domain(
    payload: DomainCreate,
    db: Session = Depends(get_db),
    _admin: User = Depends(require_admin),
) -> DomainOut:
    if domains_repo.get_by_slug(db, payload.slug) is not None:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=f"Domain with slug '{payload.slug}' already exists",
        )
    fields = payload.model_dump(exclude={"smtp_password"})
    domain = Domain(**fields)
    if payload.smtp_password:
        domains_repo.set_smtp_password(domain, payload.smtp_password)
    db.add(domain)
    db.commit()
    db.refresh(domain)
    return _to_out(domain, is_admin=True)


@router.patch("/{slug}", response_model=DomainOut)
def update_domain(
    slug: str,
    payload: DomainUpdate,
    db: Session = Depends(get_db),
    _admin: User = Depends(require_admin),
) -> DomainOut:
    domain = domains_repo.get_by_slug(db, slug)
    if domain is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Domain not found")
    data = payload.model_dump(exclude_unset=True)
    smtp_password = data.pop("smtp_password", None)
    for key, value in data.items():
        setattr(domain, key, value)
    if "smtp_password" in payload.model_fields_set:
        # Present (even if None) => caller intends to change it; omission keeps current.
        domains_repo.set_smtp_password(domain, smtp_password)
    db.commit()
    db.refresh(domain)
    return _to_out(domain, is_admin=True)


@router.delete("/{slug}", status_code=status.HTTP_204_NO_CONTENT)
def delete_domain(
    slug: str,
    db: Session = Depends(get_db),
    _admin: User = Depends(require_admin),
) -> None:
    domain = domains_repo.get_by_slug(db, slug)
    if domain is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Domain not found")
    db.delete(domain)
    db.commit()
