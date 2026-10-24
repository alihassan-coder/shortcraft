import uuid
from datetime import datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field


class UploadCreate(BaseModel):
    filename: str = Field(min_length=1, max_length=255)
    content_type: str = Field(pattern=r"^video/[\w.+-]+$")
    size_bytes: int = Field(gt=0)


class UploadTarget(BaseModel):
    """Where and how the client sends the file bytes."""

    method: Literal["PUT"] = "PUT"
    url: str
    headers: dict[str, str] = {}


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
    upload: UploadTarget
