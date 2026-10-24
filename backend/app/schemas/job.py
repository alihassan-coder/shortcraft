import uuid
from datetime import datetime
from typing import Any, Literal

from pydantic import BaseModel, ConfigDict

JobKind = Literal["transcribe", "plan", "render"]
JobStatus = Literal["queued", "running", "succeeded", "failed"]


class JobCreate(BaseModel):
    kind: JobKind


class JobRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    project_id: uuid.UUID
    kind: JobKind
    status: JobStatus
    error: str | None
    result: dict[str, Any] | None
    created_at: datetime
    updated_at: datetime
