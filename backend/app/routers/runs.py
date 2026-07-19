"""Runs router — trigger pipeline runs, list/read runs, and stream live logs.

Read endpoints require an authenticated user; the run-trigger endpoint also
requires an admin role. Live logs are exposed two ways: a simple cursor-poll
(`GET /{id}/logs?after=`) and a Server-Sent-Events stream (`GET /{id}/stream`)
that re-polls the shared Prisma client so the dashboard sees rows the engine
worker commits while the stream is open.
"""
from __future__ import annotations

import asyncio
import json
from collections.abc import AsyncIterator

from fastapi import APIRouter, Depends, HTTPException, Query, status
from fastapi.responses import StreamingResponse

from app.core.db import prisma
from app.deps import get_current_user, require_admin
from app.schemas.run import RunLogOut, RunOut, RunTrigger
from app.services import runner

router = APIRouter(prefix="/runs", tags=["runs"])

_VALID_MODES = {"full", "daily", "monitor", "report"}
_LIVE_STATUSES = {"queued", "running"}
_STREAM_MAX_ITERATIONS = 600  # ~10 min hard cap so the generator can never hang forever


async def _resolve_domain_id(domain: str | None) -> int | None:
    """Turn a ?domain= (slug OR numeric id) into a domain id, or None if absent."""
    if domain is None or domain == "":
        return None
    found = await prisma.domains.find_unique(where={"slug": domain})
    if found is None and domain.isdigit():
        found = await prisma.domains.find_unique(where={"id": int(domain)})
    if found is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=f"No domain '{domain}'")
    return found.id


async def _get_run_or_404(run_id: int):
    run = await prisma.runs.find_unique(where={"id": run_id})
    if run is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=f"Run {run_id} not found")
    return run


@router.post("/", status_code=status.HTTP_201_CREATED)
async def trigger_run(
    payload: RunTrigger,
    _admin=Depends(require_admin),
) -> dict:
    """Queue a pipeline run for the engine worker; returns the new run id."""
    if payload.mode not in _VALID_MODES:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Invalid mode '{payload.mode}'; expected one of {sorted(_VALID_MODES)}",
        )
    try:
        run_id = await runner.start_run(domain_slug=payload.domain_slug, mode=payload.mode)
    except ValueError as exc:
        # mode already validated above, so a ValueError here means the domain slug
        # did not resolve to a domain.
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc
    return {"run_id": run_id}


@router.get("/", response_model=list[RunOut])
async def list_runs(
    domain: str | None = Query(default=None, description="Filter by domain slug or id"),
    limit: int = Query(default=50, ge=1, le=500),
    _user=Depends(get_current_user),
) -> list[RunOut]:
    domain_id = await _resolve_domain_id(domain)
    where = {"domain_id": domain_id} if domain_id is not None else {}
    rows = await prisma.runs.find_many(where=where, take=limit, order={"id": "desc"})
    return [RunOut.model_validate(r) for r in rows]


@router.get("/{run_id}", response_model=RunOut)
async def get_run(
    run_id: int,
    _user=Depends(get_current_user),
) -> RunOut:
    run = await _get_run_or_404(run_id)
    return RunOut.model_validate(run)


@router.get("/{run_id}/logs", response_model=list[RunLogOut])
async def get_run_logs(
    run_id: int,
    after: int = Query(default=0, ge=0, description="Return logs with id > after"),
    _user=Depends(get_current_user),
) -> list[RunLogOut]:
    await _get_run_or_404(run_id)
    rows = await prisma.run_logs.find_many(
        where={"run_id": run_id, "id": {"gt": after}}, order={"id": "asc"}
    )
    return [RunLogOut.model_validate(r) for r in rows]


@router.get("/{run_id}/stream")
async def stream_run_logs(
    run_id: int,
    _user=Depends(get_current_user),
) -> StreamingResponse:
    """Server-Sent-Events stream of run logs until the run leaves queued/running."""
    await _get_run_or_404(run_id)

    async def event_generator() -> AsyncIterator[str]:
        cursor = 0
        for _ in range(_STREAM_MAX_ITERATIONS):
            new_logs = await prisma.run_logs.find_many(
                where={"run_id": run_id, "id": {"gt": cursor}}, order={"id": "asc"}
            )
            run = await prisma.runs.find_unique(where={"id": run_id})
            # A run is still "live" while it is waiting for the engine worker
            # (queued) as well as while it executes (running).
            run_finished = run is None or run.status not in _LIVE_STATUSES
            payloads = [
                RunLogOut.model_validate(entry).model_dump(mode="json") for entry in new_logs
            ]
            if new_logs:
                cursor = new_logs[-1].id

            for data in payloads:
                yield f"data: {json.dumps(data)}\n\n"

            if run_finished and not new_logs:
                yield "event: done\ndata: {}\n\n"
                return

            await asyncio.sleep(1)

        # Hit the iteration cap without the run terminating — close the stream cleanly.
        yield "event: done\ndata: {}\n\n"

    headers = {"Cache-Control": "no-cache", "X-Accel-Buffering": "no"}
    return StreamingResponse(event_generator(), media_type="text/event-stream", headers=headers)
