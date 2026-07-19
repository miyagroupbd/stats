"""Repository layer — all DB access goes through these functions.

Agents and the API import from app.db.repos. No agent should build SQL or touch
ORM sessions directly beyond what these helpers expose.
"""
from app.db.repos import (  # noqa: F401
    campaigns,
    domains,
    events,
    leads,
    messages,
    runs,
    suppression,
    users,
    verify,
)
