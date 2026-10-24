import uuid
from datetime import datetime
from typing import Annotated, Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator

from app.core.config import ALLOWED_VIDEO_TYPES
from app.schemas.job import JobRead


class _CamelModel(BaseModel):
    """Multipart fields use camelCase on the wire (uploadId, partSize, partNumber)."""

    model_config = ConfigDict(populate_by_name=True, serialize_by_alias=True)


class UploadCreate(BaseModel):
    filename: str = Field(min_length=1, max_length=255)
    content_type: str
    size_bytes: int = Field(gt=0)

    @field_validator("content_type")
    @classmethod
    def _allowed_video(cls, value: str) -> str:
        normalized = value.split(";", 1)[0].strip().lower()
        if normalized not in ALLOWED_VIDEO_TYPES:
            allowed = ", ".join(ALLOWED_VIDEO_TYPES)
            raise ValueError(f"content_type must be one of: {allowed}")
        return normalized


class SingleUploadTarget(BaseModel):
    """One PUT of the whole file to `url`, sending exactly `headers`."""

    mode: Literal["single"] = "single"
    method: Literal["PUT"] = "PUT"
    url: str
    headers: dict[str, str] = {}


# Kept for callers that still import the old name.
UploadTarget = SingleUploadTarget


class UploadPart(_CamelModel):
    part_number: int = Field(alias="partNumber", ge=1, le=10_000)
    url: str


class MultipartUploadTarget(_CamelModel):
    """PUT each `partSize` slice of the file to its part URL (parts may run in parallel).

    Keep the `ETag` response header of every part and send them to `.../complete`.
    The last part is the remainder and may be smaller.
    """

    mode: Literal["multipart"] = "multipart"
    upload_id: str = Field(alias="uploadId")
    part_size: int = Field(alias="partSize")
    parts: list[UploadPart]


AnyUploadTarget = Annotated[SingleUploadTarget | MultipartUploadTarget, Field(discriminator="mode")]


class CompletedPart(_CamelModel):
    part_number: int = Field(alias="partNumber", ge=1, le=10_000)
    etag: str = Field(min_length=1, max_length=200)


class UploadComplete(_CamelModel):
    """Body of `.../complete`. `parts` is required for multipart uploads only."""

    parts: list[CompletedPart] | None = None


class SourceRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    project_id: uuid.UUID
    filename: str
    content_type: str
    size_bytes: int
    # pending | uploaded | processing | ready | failed | aborted
    status: str
    # Filled by the proxy job. width/height are the upright (display) size.
    width: int | None = None
    height: int | None = None
    duration_ms: int | None = None
    fps: float | None = None
    video_codec: str | None = None
    audio_codec: str | None = None
    # Filled by the transcribe job.
    transcript_language: str | None = None
    transcript_word_count: int | None = None
    created_at: datetime


class UploadCreated(BaseModel):
    source: SourceRead
    upload: AnyUploadTarget


class SourceUrl(BaseModel):
    """Where the editor can play or download the source. `expires_in` is None if it never
    expires (local storage, public bucket)."""

    url: str
    expires_in: int | None = None


class SourceUrls(BaseModel):
    """URLs of the original and of each proxy-job artifact (None until it exists).

    - proxy: 720p H.264 MP4 for the editor
    - audio: 16 kHz mono WAV (transcription)
    - sprite / sprite_index: thumbnail sheet (JPEG) and its JSON index {frames: [{t, x, y}]}
    - peaks: waveform JSON {peaks_per_second, duration_ms, count, peaks: [0..1]}
    - transcript: transcribe-job JSON {provider, model, language, duration_ms,
      words: [{text, start_ms, end_ms, confidence, filler}]}
    """

    original: SourceUrl | None = None
    proxy: SourceUrl | None = None
    audio: SourceUrl | None = None
    sprite: SourceUrl | None = None
    sprite_index: SourceUrl | None = None
    peaks: SourceUrl | None = None
    transcript: SourceUrl | None = None


class SourceDetail(SourceRead):
    urls: SourceUrls
    # Latest proxy job for this source (poll it, or this endpoint, until it finishes).
    proxy_job: JobRead | None = None
