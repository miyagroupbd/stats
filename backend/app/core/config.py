"""Backend settings (env-driven)."""
from __future__ import annotations

import os

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    jwt_secret: str = os.getenv("JWT_SECRET", "")
    jwt_algorithm: str = "HS256"
    access_token_expire_minutes: int = 60 * 12  # 12h

    # Comma-separated allowed origins for the dashboard.
    cors_origins: str = os.getenv(
        "CORS_ORIGINS",
        "http://localhost:3000,https://stats.miyagroupbd.com",
    )

    @property
    def cors_origin_list(self) -> list[str]:
        return [o.strip() for o in self.cors_origins.split(",") if o.strip()]


settings = Settings()

# Fail fast rather than silently signing tokens with a guessable key — an unset
# or too-short JWT_SECRET would let anyone forge a superadmin token.
if len(settings.jwt_secret) < 32:
    raise RuntimeError(
        "JWT_SECRET must be set to a random string of at least 32 characters."
    )
