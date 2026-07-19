"""Domain (business-arm) repository + decrypted SMTP credential access."""
from __future__ import annotations

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.db import crypto
from app.db.models import Domain


def get(session: Session, domain_id: int) -> Domain | None:
    return session.get(Domain, domain_id)


def get_by_slug(session: Session, slug: str) -> Domain | None:
    return session.scalar(select(Domain).where(Domain.slug == slug))


def list_active(session: Session) -> list[Domain]:
    return list(session.scalars(select(Domain).where(Domain.is_active.is_(True)).order_by(Domain.slug)))


def list_all(session: Session) -> list[Domain]:
    return list(session.scalars(select(Domain).order_by(Domain.slug)))


def smtp_credentials(domain: Domain) -> dict:
    """Return decrypted SMTP/IMAP credentials for sending. Never log the result."""
    return {
        "host": domain.smtp_host,
        "port": domain.smtp_port,
        "user": domain.smtp_user,
        "password": crypto.decrypt(domain.smtp_pass_enc),
        "secure": domain.smtp_secure,
        "from_name": domain.from_name,
        "from_email": domain.from_email or domain.smtp_user,
        "reply_to": domain.reply_to,
        "imap_host": domain.imap_host,
        "imap_port": domain.imap_port,
    }


def set_smtp_password(domain: Domain, plaintext: str | None) -> None:
    """Encrypt and assign an SMTP password. Caller commits."""
    domain.smtp_pass_enc = crypto.encrypt(plaintext)
