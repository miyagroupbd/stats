"""Runs router — trigger pipeline runs, list/read runs, and stream live logs.

Read endpoints require an authenticated user; the run-trigger endpoint also
requires an admin role. Live logs are exposed two ways: a simple cursor-poll
(`GET /{id}/logs?after=`) and a Server-Sent-Events stream (`GET /{id}/stream`)
that opens a fresh short-lived session each poll so the dashboard sees rows the
background run thread commits while the stream is open.
"""
from __future__ import annotations

import json
import time
from collections.abc import Iterator

from fastapi import APIRouter, Depends, HTTPException, Query, status
from fastapi.responses import StreamingResponse
from sqlalchemy.orm import Session

from backend.app.deps import get_current_user, get_db, require_admin
from backend.app.schemas.run import RunLogOut, RunOut, RunTrigger
from backend.app.services import runner
from db.enums import RunStatus
from db.models import User
from db.repos import domains as domains_repo
from db.repos import runs as runs_repo
from db.session import session_scope

router = APIRouter(prefix="/runs", tags=["runs"])

_VALID_MODES = {"full", "daily", "monitor", "report"}
_STREAM_MAX_ITERATIONS = 600  # ~10 min hard cap so the generator can never hang forever


def _resolve_domain_id(db: Session, domain: str | None) -> int | None:
    """Turn a ?domain= (slug OR numeric id) into a domain id, or None if absent."""
    if domain is None or domain == "":
        return None
    found = domains_repo.get_by_slug(db, domain)
    if found is None and domain.isdigit():
        found = domains_repo.get(db, int(domain))
    if found is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=f"No domain '{domain}'")
    return found.id


@router.post("/", status_code=status.HTTP_201_CREATED)
def trigger_run(
    payload: RunTrigger,
    _admin: User = Depends(require_admin),
) -> dict:
    """Kick off a pipeline run in a background thread; returns the new run id."""
    if payload.mode not in _VALID_MODES:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Invalid mode '{payload.mode}'; expected one of {sorted(_VALID_MODES)}",
        )
    try:
        run_id = runner.start_run(domain_slug=payload.domain_slug, mode=payload.mode)
    except ValueError as exc:
        # mode already validated above, so a ValueError here means the domain slug
        # did not resolve to a domain.
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc
    return {"run_id": run_id}


@router.get("/", response_model=list[RunOut])
def list_runs(
    domain: str | None = Query(default=None, description="Filter by domain slug or id"),
    limit: int = Query(default=50, ge=1, le=500),
    db: Session = Depends(get_db),
    _user: User = Depends(get_current_user),
) -> list[RunOut]:
    domain_id = _resolve_domain_id(db, domain)
    rows = runs_repo.recent(db, domain_id=domain_id, limit=limit)
    return [RunOut.model_validate(r) for r in rows]


@router.get("/{run_id}", response_model=RunOut)
def get_run(
    run_id: int,
    db: Session = Depends(get_db),
    _user: User = Depends(get_current_user),
) -> RunOut:
    run = runs_repo.get(db, run_id)
    if run is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=f"Run {run_id} not found")
    return RunOut.model_validate(run)


@router.get("/{run_id}/logs", response_model=list[RunLogOut])
def get_run_logs(
    run_id: int,
    after: int = Query(default=0, ge=0, description="Return logs with id > after"),
    db: Session = Depends(get_db),
    _user: User = Depends(get_current_user),
) -> list[RunLogOut]:
    if runs_repo.get(db, run_id) is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=f"Run {run_id} not found")
    rows = runs_repo.logs_after(db, run_id, after)
    return [RunLogOut.model_validate(r) for r in rows]


@router.get("/{run_id}/stream")
def stream_run_logs(
    run_id: int,
    _user: User = Depends(get_current_user),
) -> StreamingResponse:
    """Server-Sent-Events stream of run logs until the run leaves 'running'."""
    # Short-lived session for the existence check only; the streaming generator
    # opens its own fresh session per poll, so we must not hold a pooled
    # connection checked out for the whole (up to ~10 min) stream.
    with session_scope() as s:
        run = runs_repo.get(s, run_id)
        if run is None:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND, detail=f"Run {run_id} not found"
            )

    def event_generator() -> Iterator[str]:
        cursor = 0
        for _ in range(_STREAM_MAX_ITERATIONS):
            # Fresh session per poll so we observe rows the run thread has committed.
            with session_scope() as s:
                new_logs = runs_repo.logs_after(s, run_id, cursor)
                run = runs_repo.get(s, run_id)
                # A run is still "live" while it is waiting for the engine worker
                # (QUEUED) as well as while it executes (RUNNING).
                run_finished = run is None or run.status not in (
                    RunStatus.QUEUED,
                    RunStatus.RUNNING,
                )
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

            time.sleep(1)

        # Hit the iteration cap without the run terminating — close the stream cleanly.
        yield "event: done\ndata: {}\n\n"

    headers = {"Cache-Control": "no-cache", "X-Accel-Buffering": "no"}
    return StreamingResponse(event_generator(), media_type="text/event-stream", headers=headers)
