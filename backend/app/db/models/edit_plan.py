import uuid
from typing import TYPE_CHECKING, Any

from sqlalchemy import ForeignKey, Integer
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base, TimestampMixin

if TYPE_CHECKING:
    from app.db.models import Project


class EditPlanRecord(TimestampMixin, Base):
    """The current edit plan of a project. `revision` drives optimistic concurrency."""

    __tablename__ = "edit_plans"

    project_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("projects.id", ondelete="CASCADE"), primary_key=True
    )
    schema_version: Mapped[int] = mapped_column(Integer)
    revision: Mapped[int] = mapped_column(Integer, default=1)
    plan: Mapped[dict[str, Any]]

    project: Mapped[Project] = relationship(back_populates="plan")
