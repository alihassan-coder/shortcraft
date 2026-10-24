from datetime import datetime

from pydantic import BaseModel

from app.schemas.edit_plan import EditPlan


class PlanRead(BaseModel):
    revision: int
    updated_at: datetime
    plan: EditPlan
