"""Run triggering — enqueue only (async Prisma).

The board never executes agent code. It writes a run row with status='queued';
the email-pipeline worker (`python -m engine.worker`) claims and executes it,
streaming progress into run_logs which this board reads back.
"""
from __future__ import annotations

from app.core.db import prisma

VALID_MODES = {"full", "daily", "monitor", "report"}


async def start_run(*, domain_slug: str, mode: str) -> int:
    """Queue a pipeline run for the engine worker. Returns the new run id."""
    if mode not in VALID_MODES:
        raise ValueError(f"invalid mode: {mode}")
    domain = await prisma.domains.find_unique(where={"slug": domain_slug})
    if domain is None:
        raise ValueError(f"no domain with slug '{domain_slug}'")
    run = await prisma.runs.create(
        data={
            "mode": mode,
            "domain_id": domain.id,
            "status": "queued",
            "triggered_by": "dashboard",
        }
    )
    return run.id
