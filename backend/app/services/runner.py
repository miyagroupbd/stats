"""Run triggering — enqueue only (async Prisma).

The board never executes agent code. It writes a run row with status='queued';
the email-pipeline worker (`python -m engine.worker`) claims and executes it,
streaming progress into run_logs which this board reads back.
"""
from __future__ import annotations

from app.core.db import prisma

# harvest = discover + draft only (never sends); send = A5 only, sends the
# human-approved queue (optionally one targeted message via `stage`).
VALID_MODES = {"full", "daily", "monitor", "report", "harvest", "send"}


async def start_run(*, domain_slug: str, mode: str, stage: str | None = None) -> int:
    """Queue a pipeline run for the engine worker. Returns the new run id.

    `stage` targets a single message on a `send` run (individual send) — the
    worker's A5 reads run.stage and sends only that approved message.
    """
    if mode not in VALID_MODES:
        raise ValueError(f"invalid mode: {mode}")
    domain = await prisma.domains.find_unique(where={"slug": domain_slug})
    if domain is None:
        raise ValueError(f"no domain with slug '{domain_slug}'")
    data: dict = {
        "mode": mode,
        "domain_id": domain.id,
        "status": "queued",
        "triggered_by": "dashboard",
    }
    if stage is not None:
        data["stage"] = stage
    run = await prisma.runs.create(data=data)
    return run.id
