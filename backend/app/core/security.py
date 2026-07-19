"""Auth + secret handling: JWT issue/verify, Argon2id passwords, Fernet crypto.

Consolidated here (house pattern) — previously split across app/security.py,
db/passwords.py and db/crypto.py under the SQLAlchemy layout.
"""
from __future__ import annotations

import base64
import hashlib
import os
from datetime import datetime, timedelta, timezone

import jwt
from argon2 import PasswordHasher
from argon2.exceptions import InvalidHashError, VerificationError, VerifyMismatchError
from cryptography.fernet import Fernet, InvalidToken

from app.core.config import settings

# ── JWT ─────────────────────────────────────────────────────────────────────
def create_access_token(*, user_id: int, email: str, role: str) -> str:
    now = datetime.now(timezone.utc)
    payload = {
        "sub": str(user_id),
        "email": email,
        "role": role,
        "iat": now,
        "exp": now + timedelta(minutes=settings.access_token_expire_minutes),
    }
    return jwt.encode(payload, settings.jwt_secret, algorithm=settings.jwt_algorithm)


def decode_access_token(token: str) -> dict | None:
    try:
        return jwt.decode(token, settings.jwt_secret, algorithms=[settings.jwt_algorithm])
    except jwt.PyJWTError:
        return None


# ── Passwords (Argon2id) ────────────────────────────────────────────────────
_ph = PasswordHasher()


def hash_password(plaintext: str) -> str:
    return _ph.hash(plaintext)


def verify_password(hashed: str, plaintext: str) -> bool:
    try:
        return _ph.verify(hashed, plaintext)
    except (VerifyMismatchError, VerificationError, InvalidHashError):
        return False


# ── Secret encryption at rest (per-domain SMTP passwords) ───────────────────
# Must use the SAME APP_SECRET as the email-pipeline or its ciphertext won't open.
_ENC_PREFIX = "enc::"


def _fernet() -> Fernet:
    secret = os.getenv("APP_SECRET")
    if not secret:
        raise RuntimeError("APP_SECRET is not set — required to decrypt stored secrets.")
    key = base64.urlsafe_b64encode(hashlib.sha256(secret.encode()).digest())
    return Fernet(key)


def encrypt(plaintext: str | None) -> str | None:
    if not plaintext:
        return plaintext
    return _ENC_PREFIX + _fernet().encrypt(plaintext.encode()).decode()


def decrypt(value: str | None) -> str | None:
    if not value or not value.startswith(_ENC_PREFIX):
        return value
    try:
        return _fernet().decrypt(value[len(_ENC_PREFIX):].encode()).decode()
    except InvalidToken as exc:
        raise RuntimeError("Failed to decrypt secret — APP_SECRET may have changed.") from exc


def is_encrypted(value: str | None) -> bool:
    return bool(value) and value.startswith(_ENC_PREFIX)
