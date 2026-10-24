import uuid
from datetime import datetime
from typing import Any, Literal

from pydantic import BaseModel, ConfigDict

JobKind = Literal["proxy", "transcribe", "plan", "render"]
"""What a job does.

- proxy: make a 720p H.264 MP4 copy of an uploaded source for the editor. Phone videos are
  often HEVC in a .mov file, and Chrome (and other browsers) often cannot play them. So after
  upload we create `proxy-720p.mp4` next to the original and the editor plays that. The
  original is still used for the final render. Also writes 16 kHz mono audio, a thumbnail
  sprite and waveform peaks, and fills the source's metadata. Enqueued automatically when an
  upload completes; needs `source_id` when created by hand.
- transcribe: speech to words with timings (Deepgram, or the offline fake), fillers kept.
  Needs `source_id` (after proxy). Optional params: {"language": "en", "vibe": ...}.
  Enqueued after a proxy job when TRANSCRIBE_ON_UPLOAD=true.
- plan: write the edit plan. Today only params {"mode": "basic", "vibe":
  "energetic" | "clean" | "story"}: silences, fillers and retakes cut without AI, default
  captions/zooms/hook/music. Needs `source_id` (after transcribe). Saved as the next plan
  revision. Enqueued after a transcribe job when AUTO_PLAN=true.
- render: final video render.
"""
JobStatus = Literal["queued", "running", "succeeded", "failed"]


class JobCreate(BaseModel):
    kind: JobKind
    # The source a media job works on (required for `proxy` to succeed).
    source_id: uuid.UUID | None = None
    # Extra input for the job kind (see JobKind).
    params: dict[str, Any] | None = None


class JobRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    project_id: uuid.UUID
    kind: JobKind
    source_id: uuid.UUID | None = None
    params: dict[str, Any] | None = None
    status: JobStatus
    progress: int = 0  # 0-100
    error: str | None
    result: dict[str, Any] | None
    started_at: datetime | None = None
    finished_at: datetime | None = None
    created_at: datetime
    updated_at: datetime
