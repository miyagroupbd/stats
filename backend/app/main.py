"""FastAPI app entrypoint for the stats.miyagroupbd.com dashboard backend."""
from __future__ import annotations

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from backend.app.config import settings
from backend.app.routers import (
    auth,
    automations,
    campaigns,
    domains,
    leads,
    messages,
    runs,
    stats,
)

app = FastAPI(title="Miya Stats API", version="1.0.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origin_list,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/health", tags=["health"])
def health() -> dict:
    return {"status": "ok"}


app.include_router(auth.router)
app.include_router(automations.router)
app.include_router(domains.router)
app.include_router(leads.router)
app.include_router(campaigns.router)
app.include_router(messages.router)
app.include_router(runs.router)
app.include_router(stats.router)
