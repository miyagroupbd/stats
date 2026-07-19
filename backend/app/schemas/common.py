"""Shared schema primitives."""
from __future__ import annotations

from pydantic import BaseModel


class Message(BaseModel):
    detail: str


class Page(BaseModel):
    """Generic paginated envelope (items typed by each router)."""
    total: int
    limit: int
    offset: int
