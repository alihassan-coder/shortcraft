import uuid
from typing import TYPE_CHECKING

from sqlalchemy import String, Uuid
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base, TimestampMixin

if TYPE_CHECKING:
    from app.db.models import EditPlanRecord, Job, Source


class Project(TimestampMixin, Base):
    __tablename__ = "projects"

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid.uuid4)
    title: Mapped[str] = mapped_column(String(200))
    # Supabase auth user id (JWT "sub"). Nullable while anonymous use is allowed.
    owner_id: Mapped[uuid.UUID | None] = mapped_column(Uuid, index=True)

    sources: Mapped[list[Source]] = relationship(
        back_populates="project", cascade="all, delete-orphan", passive_deletes=True
    )
    plan: Mapped[EditPlanRecord | None] = relationship(
        back_populates="project", cascade="all, delete-orphan", passive_deletes=True
    )
    jobs: Mapped[list[Job]] = relationship(
        back_populates="project", cascade="all, delete-orphan", passive_deletes=True
    )
