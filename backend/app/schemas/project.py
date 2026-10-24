import uuid
from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field

Title = Field(min_length=1, max_length=200)


class ProjectCreate(BaseModel):
    title: str = Title


class ProjectUpdate(BaseModel):
    title: str = Title


class ProjectRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    title: str
    created_at: datetime
    updated_at: datetime
