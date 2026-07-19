"""FastAPI entrypoint for the Miya Stats control plane (stats.miyagroupbd.com)."""
from __future__ import annotations

from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.core.config import settings
from app.core.db import connect_db, disconnect_db
from app.routers import (
    auth,
    automations,
    campaigns,
    domains,
    leads,
    messages,
    runs,
    stats,
)


@asynccontextmanager
async def lifespan(app: FastAPI):
    try:
        await connect_db()
    except Exception as exc:  # pragma: no cover — boot even if Postgres is down
        print(f"[startup] database not connected: {exc}")
    yield
    try:
        await disconnect_db()
    except Exception:  # pragma: no cover
        pass


app = FastAPI(title="Miya Stats API", version="1.0.0", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origin_list,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/health", tags=["health"])
async def health() -> dict:
    return {"status": "ok"}


app.include_router(auth.router)
app.include_router(automations.router)
app.include_router(domains.router)
app.include_router(leads.router)
app.include_router(campaigns.router)
app.include_router(messages.router)
app.include_router(runs.router)
app.include_router(stats.router)
