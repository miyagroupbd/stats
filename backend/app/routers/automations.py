"""Automations router — N8N workflow + execution reporting for the board."""
from __future__ import annotations

from fastapi import APIRouter, Depends

from app.deps import get_current_user
from app.integrations import n8n
from app.db.models import User

router = APIRouter(prefix="/automations", tags=["automations"])


@router.get("/summary")
def automations_summary(_user: User = Depends(get_current_user)) -> dict:
    """Headline N8N health for the overview board (safe when N8N is unconfigured)."""
    return n8n.summary()


@router.get("/workflows")
def automations_workflows(
    limit: int = 100, _user: User = Depends(get_current_user)
) -> dict:
    return {"configured": n8n.enabled(), "items": n8n.list_workflows(limit=limit)}


@router.get("/executions")
def automations_executions(
    limit: int = 100,
    workflow_id: str | None = None,
    _user: User = Depends(get_current_user),
) -> dict:
    return {
        "configured": n8n.enabled(),
        "items": n8n.list_executions(limit=limit, workflow_id=workflow_id),
    }
