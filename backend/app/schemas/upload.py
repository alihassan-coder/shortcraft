import uuid
from datetime import datetime
from typing import Annotated, Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator

from app.core.config import ALLOWED_VIDEO_TYPES


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
    status: str
    created_at: datetime


class UploadCreated(BaseModel):
    source: SourceRead
    upload: AnyUploadTarget


class SourceUrl(BaseModel):
    """Where the editor can play or download the source. `expires_in` is None if it never
    expires (local storage, public bucket)."""

    url: str
    expires_in: int | None = None
