import uuid

from fastapi import APIRouter, status

from app.api.deps import JobQueueDep, SessionDep
from app.schemas.job import JobCreate, JobRead
from app.services import jobs as service

router = APIRouter(prefix="/projects/{project_id}/jobs", tags=["jobs"])


@router.post("", response_model=JobRead, status_code=status.HTTP_202_ACCEPTED)
async def create_job(
    project_id: uuid.UUID, data: JobCreate, session: SessionDep, queue: JobQueueDep
):
    return await service.create_job(session, queue, project_id, data.kind)


@router.get("/{job_id}", response_model=JobRead)
async def get_job(project_id: uuid.UUID, job_id: uuid.UUID, session: SessionDep):
    return await service.get_job(session, project_id, job_id)
