import logging
import uuid

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.errors import NotFoundError
from app.db.base import utcnow
from app.db.models import Job, Source
from app.schemas.job import JobKind
from app.services.job_queue import JobQueue
from app.services.projects import get_project
from app.worker.runner import has_handler

logger = logging.getLogger(__name__)


async def create_job(
    session: AsyncSession,
    queue: JobQueue,
    project_id: uuid.UUID,
    kind: JobKind,
    *,
    source_id: uuid.UUID | None = None,
) -> Job:
    await get_project(session, project_id)
    if source_id is not None:
        source = await session.get(Source, source_id)
        if source is None or source.project_id != project_id:
            raise NotFoundError("Source not found")
    job = Job(project_id=project_id, kind=kind, status="queued", source_id=source_id, progress=0)
    session.add(job)
    await session.commit()
    if not has_handler(kind):
        logger.info("Job %s (%s) stays queued: no worker for this kind yet", job.id, kind)
        return job
    try:
        await queue.enqueue(job.id, kind)
    except Exception:
        logger.exception("Could not enqueue job %s", job.id)
        job.status = "failed"
        job.error = "Could not reach the job queue"
        job.finished_at = utcnow()
        await session.commit()
    return job


async def get_job(session: AsyncSession, project_id: uuid.UUID, job_id: uuid.UUID) -> Job:
    job = await session.get(Job, job_id)
    if job is None or job.project_id != project_id:
        raise NotFoundError("Job not found")
    return job


async def latest_job(
    session: AsyncSession, project_id: uuid.UUID, source_id: uuid.UUID, kind: JobKind
) -> Job | None:
    stmt = (
        select(Job)
        .filter_by(project_id=project_id, source_id=source_id, kind=kind)
        .order_by(Job.created_at.desc())
        .limit(1)
    )
    return await session.scalar(stmt)
