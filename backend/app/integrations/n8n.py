"""N8N client — powers the automation-board reports.

Talks to a self-hosted or cloud N8N instance's public REST API:
    GET /api/v1/workflows          list workflows (active/inactive)
    GET /api/v1/executions         recent executions (status, timings)
Auth is the `X-N8N-API-KEY` header (N8N Settings → API → create an API key).

Key-gated: with no N8N_BASE_URL/N8N_API_KEY the client reports unconfigured and
every call returns empty data instead of raising, so the board still renders.
"""
from __future__ import annotations

import os
from datetime import datetime, timezone

import httpx

N8N_BASE_URL = os.getenv("N8N_BASE_URL", "").rstrip("/")
N8N_API_KEY = os.getenv("N8N_API_KEY", "")

_TIMEOUT = 20.0


def enabled() -> bool:
    return bool(N8N_BASE_URL and N8N_API_KEY)


def _headers() -> dict:
    return {"X-N8N-API-KEY": N8N_API_KEY, "Accept": "application/json"}


def _get(path: str, params: dict | None = None) -> dict | None:
    if not enabled():
        return None
    try:
        with httpx.Client(timeout=_TIMEOUT) as c:
            resp = c.get(f"{N8N_BASE_URL}/api/v1{path}", headers=_headers(), params=params or {})
        if resp.status_code != 200:
            return None
        return resp.json()
    except Exception:  # noqa: BLE001 — a down N8N must not break the board
        return None


def list_workflows(limit: int = 100) -> list[dict]:
    data = _get("/workflows", {"limit": limit})
    if not data:
        return []
    return [
        {
            "id": w.get("id"),
            "name": w.get("name"),
            "active": bool(w.get("active")),
            "created_at": w.get("createdAt"),
            "updated_at": w.get("updatedAt"),
            "tags": [t.get("name") for t in (w.get("tags") or []) if isinstance(t, dict)],
        }
        for w in (data.get("data") or [])
    ]


def list_executions(limit: int = 100, workflow_id: str | None = None) -> list[dict]:
    params: dict = {"limit": limit}
    if workflow_id:
        params["workflowId"] = workflow_id
    data = _get("/executions", params)
    if not data:
        return []
    out = []
    for e in (data.get("data") or []):
        # N8N reports either `status` or the older `finished`/`stoppedAt` shape.
        status = e.get("status")
        if not status:
            status = "success" if e.get("finished") else "running"
        out.append({
            "id": e.get("id"),
            "workflow_id": e.get("workflowId"),
            "workflow_name": (e.get("workflowData") or {}).get("name"),
            "status": status,
            "mode": e.get("mode"),
            "started_at": e.get("startedAt"),
            "stopped_at": e.get("stoppedAt"),
        })
    return out


def summary() -> dict:
    """Aggregate for the board: workflow + execution health at a glance."""
    if not enabled():
        return {
            "configured": False,
            "workflows": 0, "active_workflows": 0,
            "executions": 0, "succeeded": 0, "failed": 0, "running": 0,
            "success_rate": 0.0,
            "checked_at": datetime.now(timezone.utc).isoformat(),
        }
    workflows = list_workflows()
    executions = list_executions()
    succeeded = sum(1 for e in executions if e["status"] in ("success", "succeeded"))
    failed = sum(1 for e in executions if e["status"] in ("error", "failed", "crashed"))
    running = sum(1 for e in executions if e["status"] in ("running", "waiting", "new"))
    finished = succeeded + failed
    return {
        "configured": True,
        "workflows": len(workflows),
        "active_workflows": sum(1 for w in workflows if w["active"]),
        "executions": len(executions),
        "succeeded": succeeded,
        "failed": failed,
        "running": running,
        "success_rate": round(succeeded / finished, 3) if finished else 0.0,
        "checked_at": datetime.now(timezone.utc).isoformat(),
    }
