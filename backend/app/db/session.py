"""Engine + session factory. Shared by engine/ and backend/.

DATABASE_URL from env. Sync engine (agents are synchronous; FastAPI uses a
threadpool dependency). Async URL support kept simple: we run sync.
"""
from __future__ import annotations

import os
from collections.abc import Iterator
from contextlib import contextmanager

from sqlalchemy import create_engine
from sqlalchemy.orm import Session, sessionmaker

DATABASE_URL = os.getenv(
    "DATABASE_URL",
    # Matches docker-compose.yml (host port 5433 to avoid clashing with other
    # local Postgres instances). Override via .env / Coolify in real envs.
    "postgresql+psycopg://mgl:mgl@localhost:5433/email_pipeline",
)

# psycopg (v3) driver. Normalize a bare postgres:// URL (Coolify/Heroku style).
if DATABASE_URL.startswith("postgres://"):
    DATABASE_URL = DATABASE_URL.replace("postgres://", "postgresql+psycopg://", 1)
elif DATABASE_URL.startswith("postgresql://") and "+psycopg" not in DATABASE_URL:
    DATABASE_URL = DATABASE_URL.replace("postgresql://", "postgresql+psycopg://", 1)

engine = create_engine(
    DATABASE_URL,
    pool_pre_ping=True,
    pool_size=5,
    max_overflow=10,
    future=True,
)

SessionLocal = sessionmaker(bind=engine, autoflush=False, expire_on_commit=False, class_=Session)


@contextmanager
def session_scope() -> Iterator[Session]:
    """Transactional scope. Commits on success, rolls back on error."""
    s = SessionLocal()
    try:
        yield s
        s.commit()
    except Exception:
        s.rollback()
        raise
    finally:
        s.close()


def get_session() -> Iterator[Session]:
    """FastAPI dependency — yields a session, closes after request."""
    s = SessionLocal()
    try:
        yield s
    finally:
        s.close()
