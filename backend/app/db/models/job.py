import uuid
from datetime import datetime
from typing import TYPE_CHECKING, Any

from sqlalchemy import ForeignKey, Integer, String, Text, Uuid
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base, TimestampMixin

if TYPE_CHECKING:
    from app.db.models import Project


class Job(TimestampMixin, Base):
    __tablename__ = "jobs"

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid.uuid4)
    project_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("projects.id", ondelete="CASCADE"), index=True
    )
    kind: Mapped[str] = mapped_column(String(20))  # see app.schemas.job.JobKind
    # Input: the source a media job works on (proxy, transcribe).
    source_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("sources.id", ondelete="SET NULL"), index=True
    )
    # Extra input, e.g. {"vibe": "clean"} for a plan job, {"language": "en"} for transcribe.
    params: Mapped[dict[str, Any] | None]
    # queued -> running -> succeeded | failed
    status: Mapped[str] = mapped_column(String(20), default="queued")
    progress: Mapped[int] = mapped_column(Integer, default=0, server_default="0")  # 0-100
    error: Mapped[str | None] = mapped_column(Text)
    result: Mapped[dict[str, Any] | None]
    started_at: Mapped[datetime | None]
    finished_at: Mapped[datetime | None]

    project: Mapped[Project] = relationship(back_populates="jobs")
