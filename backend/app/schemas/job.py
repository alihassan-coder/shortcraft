import uuid
from datetime import datetime
from typing import Any, Literal

from pydantic import BaseModel, ConfigDict

JobKind = Literal["proxy", "transcribe", "plan", "render"]
"""What a job does.

- proxy: make a 720p H.264 MP4 copy of an uploaded source for the editor. Phone videos are
  often HEVC in a .mov file, and Chrome (and other browsers) often cannot play them. So after
  upload we create `proxy-720p.mp4` next to the original and the editor plays that. The
  original is still used for the final render. (Worker comes later.)
- transcribe: speech to words with timings (Deepgram).
- plan: AI agents write the edit plan.
- render: final video render.
"""
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
