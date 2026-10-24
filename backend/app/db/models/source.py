import uuid
from typing import TYPE_CHECKING

from sqlalchemy import BigInteger, Float, ForeignKey, Integer, String, Uuid
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base, TimestampMixin

if TYPE_CHECKING:
    from app.db.models import Project


class Source(TimestampMixin, Base):
    """An uploaded video file and its metadata."""

    __tablename__ = "sources"

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid.uuid4)
    project_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("projects.id", ondelete="CASCADE"), index=True
    )
    filename: Mapped[str] = mapped_column(String(255))
    content_type: Mapped[str] = mapped_column(String(100))
    size_bytes: Mapped[int] = mapped_column(BigInteger)
    storage_key: Mapped[str] = mapped_column(String(512), unique=True)
    # pending -> uploaded -> processing -> ready | failed (proxy job), or aborted.
    status: Mapped[str] = mapped_column(String(20), default="pending")
    # S3 multipart upload id while a multipart upload is in progress (R2 only).
    upload_id: Mapped[str | None] = mapped_column(String(1024))
    # Filled by the proxy job (ffprobe). width/height are the upright (display) size.
    width: Mapped[int | None] = mapped_column(Integer)
    height: Mapped[int | None] = mapped_column(Integer)
    duration_ms: Mapped[int | None] = mapped_column(Integer)
    fps: Mapped[float | None] = mapped_column(Float)
    video_codec: Mapped[str | None] = mapped_column(String(50))
    audio_codec: Mapped[str | None] = mapped_column(String(50))
    # Storage keys of the proxy job's outputs (None until made; audio/peaks None if silent).
    proxy_key: Mapped[str | None] = mapped_column(String(512))
    audio_key: Mapped[str | None] = mapped_column(String(512))
    sprite_key: Mapped[str | None] = mapped_column(String(512))
    sprite_index_key: Mapped[str | None] = mapped_column(String(512))
    peaks_key: Mapped[str | None] = mapped_column(String(512))
    # Filled by the transcribe job: transcript JSON key, spoken language, number of words.
    transcript_key: Mapped[str | None] = mapped_column(String(512))
    transcript_language: Mapped[str | None] = mapped_column(String(20))
    transcript_word_count: Mapped[int | None] = mapped_column(Integer)

    project: Mapped[Project] = relationship(back_populates="sources")

    @property
    def has_file(self) -> bool:
        """True once the original's bytes are in storage."""
        return self.status in FILE_STATUSES

    def stored_keys(self) -> list[str]:
        """The original plus every artifact key that is set."""
        keys = (
            self.storage_key,
            self.proxy_key,
            self.audio_key,
            self.sprite_key,
            self.sprite_index_key,
            self.peaks_key,
            self.transcript_key,
        )
        return [key for key in keys if key]


FILE_STATUSES = frozenset({"uploaded", "processing", "ready", "failed"})
