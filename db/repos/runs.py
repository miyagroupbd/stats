"""Run + RunLog repository — the job model that powers the dashboard live view."""
from __future__ import annotations

from datetime import datetime, timezone

from sqlalchemy import select
from sqlalchemy.orm import Session

from db.enums import RunMode, RunStatus, TriggeredBy
from db.models import Run, RunLog


def start(
    session: Session,
    *,
    mode: RunMode,
    domain_id: int | None = None,
    stage: str | None = None,
    triggered_by: TriggeredBy = TriggeredBy.CLI,
) -> Run:
    run = Run(mode=mode, domain_id=domain_id, stage=stage, triggered_by=triggered_by)
    session.add(run)
    session.flush()  # assign run.id immediately so logs can reference it
    return run


def finish(session: Session, run: Run, *, status: RunStatus, stats: dict | None = None, error: str | None = None) -> None:
    run.status = status
    run.finished_at = datetime.now(timezone.utc)
    if stats is not None:
        run.stats = stats
    if error is not None:
        run.error = error


def log(session: Session, run_id: int, message: str, *, agent: str | None = None, level: str = "info") -> RunLog:
    entry = RunLog(run_id=run_id, message=message, agent=agent, level=level)
    session.add(entry)
    return entry


def get(session: Session, run_id: int) -> Run | None:
    return session.get(Run, run_id)


def recent(session: Session, *, domain_id: int | None = None, limit: int = 50) -> list[Run]:
    stmt = select(Run).order_by(Run.id.desc()).limit(limit)
    if domain_id is not None:
        stmt = stmt.where(Run.domain_id == domain_id)
    return list(session.scalars(stmt))


def logs_after(session: Session, run_id: int, after_id: int = 0) -> list[RunLog]:
    """Fetch logs with id > after_id — SSE cursor pattern for streaming."""
    stmt = (
        select(RunLog)
        .where(RunLog.run_id == run_id, RunLog.id > after_id)
        .order_by(RunLog.id.asc())
    )
    return list(session.scalars(stmt))
