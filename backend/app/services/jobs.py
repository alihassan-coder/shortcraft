import uuid

from sqlalchemy.ext.asyncio import AsyncSession

from app.core.errors import NotFoundError
from app.db.models import Job
from app.schemas.job import JobKind
from app.services.job_queue import JobQueue
from app.services.projects import get_project


async def create_job(
    session: AsyncSession, queue: JobQueue, project_id: uuid.UUID, kind: JobKind
) -> Job:
    await get_project(session, project_id)
    job = Job(project_id=project_id, kind=kind, status="queued")
    session.add(job)
    await session.commit()
    await queue.enqueue(job.id, kind)
    return job


async def get_job(session: AsyncSession, project_id: uuid.UUID, job_id: uuid.UUID) -> Job:
    job = await session.get(Job, job_id)
    if job is None or job.project_id != project_id:
        raise NotFoundError("Job not found")
    return job
