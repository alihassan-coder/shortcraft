import copy
import re
import uuid
from collections.abc import Callable
from typing import Any

from sqlalchemy import update
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import ALLOWED_VIDEO_TYPES
from app.core.errors import NotFoundError, PreconditionFailedError, PreconditionRequiredError
from app.db.base import utcnow
from app.db.models import EditPlanRecord
from app.schemas.edit_plan import EditPlan
from app.services.projects import get_project
from app.services.storage import SOURCE_ARTIFACTS, StorageAdapter


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


_SOURCE_FILE_KEY = re.compile(
    r"^projects/(?P<pid>[0-9a-f-]{36})/sources/(?P<sid>[0-9a-f-]{36})/(?P<name>[A-Za-z0-9._-]+)$"
)


async def resolve_media_urls(
    plan: dict[str, Any],
    project_id: uuid.UUID,
    storage: StorageAdapter,
    *,
    local_url_for: Callable[[uuid.UUID, str], str],
) -> tuple[dict[str, Any], int | None]:
    """Copy of `plan` with every `sources[].src` / `poster` that is a storage key of this
    project replaced by a playable URL (R2: presigned GET; local: this API's file route).

    Stored plans keep storage keys (they never expire); clients load this resolved copy for
    playback and keep saving the stored form. Returns (plan, shortest expires_in or None).
    """
    resolved = copy.deepcopy(plan)
    expiries: list[int] = []
    for source in resolved.get("sources") or []:
        for field in ("src", "poster"):
            key = source.get(field)
            match = _SOURCE_FILE_KEY.match(key) if isinstance(key, str) else None
            if match is None or match["pid"] != str(project_id):
                continue
            name = match["name"]
            content_type = SOURCE_ARTIFACTS.get(name) or "application/octet-stream"
            if name.startswith("original."):
                content_type = next(
                    (t for t, ext in ALLOWED_VIDEO_TYPES.items() if name == f"original.{ext}"),
                    content_type,
                )
            url, expires_in = await storage.download_url(
                key,
                filename=name,
                content_type=content_type,
                local_url=local_url_for(uuid.UUID(match["sid"]), name),
            )
            source[field] = url
            if expires_in is not None:
                expiries.append(expires_in)
    return resolved, min(expiries) if expiries else None
