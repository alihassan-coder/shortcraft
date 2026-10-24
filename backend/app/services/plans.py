import uuid

from sqlalchemy import update
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.errors import NotFoundError, PreconditionFailedError, PreconditionRequiredError
from app.db.base import utcnow
from app.db.models import EditPlanRecord
from app.schemas.edit_plan import EditPlan
from app.services.projects import get_project


async def get_plan(session: AsyncSession, project_id: uuid.UUID) -> EditPlanRecord:
    await get_project(session, project_id)
    record = await session.get(EditPlanRecord, project_id)
    if record is None:
        raise NotFoundError("Project has no edit plan yet", code="plan_not_found")
    return record


async def save_plan(
    session: AsyncSession,
    project_id: uuid.UUID,
    plan: EditPlan,
    expected_revision: int | None,
) -> EditPlanRecord:
    """Create or replace the plan.

    Creating needs no revision. Replacing needs the caller's current revision, and the
    UPDATE is guarded by it so concurrent writers cannot silently overwrite each other.
    """
    await get_project(session, project_id)
    data = plan.model_dump(mode="json", by_alias=True)
    record = await session.get(EditPlanRecord, project_id)

    if record is None:
        if expected_revision not in (None, 0):
            raise PreconditionFailedError("Plan does not exist at that revision")
        record = EditPlanRecord(
            project_id=project_id, schema_version=plan.version, revision=1, plan=data
        )
        session.add(record)
        try:
            await session.commit()
        except IntegrityError:
            await session.rollback()
            raise PreconditionFailedError("Plan was created concurrently") from None
        return record

    if expected_revision is None:
        raise PreconditionRequiredError("Send If-Match with the current plan revision")

    result = await session.execute(
        update(EditPlanRecord)
        .where(
            EditPlanRecord.project_id == project_id,
            EditPlanRecord.revision == expected_revision,
        )
        .values(
            plan=data,
            schema_version=plan.version,
            revision=EditPlanRecord.revision + 1,
            updated_at=utcnow(),
        )
        .execution_options(synchronize_session=False)
    )
    if result.rowcount == 0:  # type: ignore[attr-defined]
        current = record.revision
        await session.rollback()
        raise PreconditionFailedError(f"Plan revision is {current}, not {expected_revision}")
    await session.commit()
    await session.refresh(record)
    return record
