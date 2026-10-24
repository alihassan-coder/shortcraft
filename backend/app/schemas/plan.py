from datetime import datetime

from pydantic import BaseModel

from app.schemas.edit_plan import EditPlan


class PlanRead(BaseModel):
    revision: int
    updated_at: datetime
    plan: EditPlan


class PlanResolved(PlanRead):
    """The stored plan with storage keys in `sources[].src` / `poster` swapped for playable
    URLs. Do not PUT this back: save the plan from `GET /plan` (keys never expire)."""

    # Seconds until the shortest-lived URL expires (None: local URLs, or no keys to resolve).
    expires_in: int | None = None
