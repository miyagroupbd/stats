"""Symmetric encryption for secrets at rest (SMTP passwords, provider keys).

Uses Fernet (AES-128-CBC + HMAC). Key derived from APP_SECRET env via SHA-256,
so operators can set any-length APP_SECRET string. Never log decrypted values.
"""
from __future__ import annotations

import base64
import hashlib
import os

from cryptography.fernet import Fernet, InvalidToken

_ENC_PREFIX = "enc::"


def _fernet() -> Fernet:
    secret = os.getenv("APP_SECRET")
    if not secret:
        raise RuntimeError(
            "APP_SECRET is not set — required to encrypt/decrypt stored secrets."
        )
    key = base64.urlsafe_b64encode(hashlib.sha256(secret.encode()).digest())
    return Fernet(key)


def encrypt(plaintext: str | None) -> str | None:
    """Encrypt a secret. Returns a prefixed token, or None/'' unchanged."""
    if plaintext is None or plaintext == "":
        return plaintext
    token = _fernet().encrypt(plaintext.encode()).decode()
    return _ENC_PREFIX + token


def decrypt(value: str | None) -> str | None:
    """Decrypt a stored token. Passes through None/'' and non-encrypted legacy values."""
    if value is None or value == "":
        return value
    if not value.startswith(_ENC_PREFIX):
        # Legacy/plaintext value stored before encryption was enabled.
        return value
    token = value[len(_ENC_PREFIX):]
    try:
        return _fernet().decrypt(token.encode()).decode()
    except InvalidToken as exc:
        raise RuntimeError("Failed to decrypt secret — APP_SECRET may have changed.") from exc


def is_encrypted(value: str | None) -> bool:
    return bool(value) and value.startswith(_ENC_PREFIX)
