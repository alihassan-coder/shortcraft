"""Edit plan of a project. Optimistic concurrency via ETag / If-Match on the revision."""

import uuid
from typing import Annotated

from fastapi import APIRouter, Header, Response

from app.api.deps import SessionDep
from app.core.errors import AppError
from app.db.models import EditPlanRecord
from app.schemas.edit_plan import EditPlan
from app.schemas.plan import PlanRead
from app.services import plans as service

router = APIRouter(prefix="/projects/{project_id}/plan", tags=["plans"])


def _etag(revision: int) -> str:
    return f'"{revision}"'


def _parse_if_match(value: str | None) -> int | None:
    if value is None:
        return None
    raw = value.strip().removeprefix("W/").strip('"')
    if not raw.isdigit():
        raise AppError('If-Match must be a plan revision ETag, e.g. "3"', code="bad_if_match")
    return int(raw)


def _read(record: EditPlanRecord, response: Response) -> PlanRead:
    response.headers["ETag"] = _etag(record.revision)
    return PlanRead(
        revision=record.revision,
        updated_at=record.updated_at,
        plan=EditPlan.model_validate(record.plan),
    )


@router.get("", response_model=PlanRead)
async def get_plan(project_id: uuid.UUID, session: SessionDep, response: Response):
    return _read(await service.get_plan(session, project_id), response)


@router.put("", response_model=PlanRead)
async def put_plan(
    project_id: uuid.UUID,
    plan: EditPlan,
    session: SessionDep,
    response: Response,
    if_match: Annotated[str | None, Header()] = None,
):
    """Create the plan (no If-Match) or replace it (If-Match: "<current revision>")."""
    record = await service.save_plan(session, project_id, plan, _parse_if_match(if_match))
    return _read(record, response)
