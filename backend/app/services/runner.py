"""Run triggering — enqueue only.

The stats board and the email-pipeline engine are separate deployables, so the
board never imports or executes agent code. Triggering a run just writes a Run
row with status=QUEUED; the engine's worker (`python -m engine.worker` in the
email-pipeline project) polls for queued runs and executes them, streaming
progress back into runs/run_logs — which this board already reads.

That keeps the two systems decoupled: they share only the Postgres.
"""
from __future__ import annotations

from db.enums import RunMode, RunStatus, TriggeredBy
from db.models import Run
from db.repos import domains as domains_repo
from db.session import session_scope

_MODE_MAP = {
    "full": RunMode.FULL,
    "daily": RunMode.DAILY,
    "monitor": RunMode.MONITOR,
    "report": RunMode.REPORT,
}


def start_run(*, domain_slug: str, mode: str) -> int:
    """Queue a pipeline run for the engine worker. Returns the new run id."""
    if mode not in _MODE_MAP:
        raise ValueError(f"invalid mode: {mode}")

    with session_scope() as session:
        domain = domains_repo.get_by_slug(session, domain_slug)
        if domain is None:
            raise ValueError(f"no domain with slug '{domain_slug}'")
        run = Run(
            mode=_MODE_MAP[mode],
            domain_id=domain.id,
            status=RunStatus.QUEUED,
            triggered_by=TriggeredBy.DASHBOARD,
        )
        session.add(run)
        session.flush()
        return run.id
