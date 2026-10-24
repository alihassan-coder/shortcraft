"""Start a follow-up job from inside a job (proxy -> transcribe -> plan)."""

import logging
import uuid
from typing import Any

from app.db.base import utcnow
from app.db.models import Job
from app.worker.context import JobContext

logger = logging.getLogger(__name__)


async def enqueue_followup(
    ctx: JobContext,
    project_id: uuid.UUID,
    source_id: uuid.UUID,
    kind: str,
    params: dict[str, Any] | None = None,
) -> uuid.UUID | None:
    """Create a queued job row and send it to the queue. Returns its id (None if this
    context cannot enqueue). Never raises: a chaining problem must not fail the parent job."""
    if ctx.enqueue is None:
        logger.info("No queue in this job context; not chaining a %s job", kind)
        return None
    async with ctx.sessionmaker() as session:
        job = Job(
            project_id=project_id,
            source_id=source_id,
            kind=kind,
            status="queued",
            progress=0,
            params=params,
        )
        session.add(job)
        await session.commit()
        job_id = job.id
        try:
            await ctx.enqueue(job_id, kind)
        except Exception:
            logger.exception("Could not enqueue follow-up %s job %s", kind, job_id)
            job.status = "failed"
            job.error = "Could not reach the job queue"
            job.finished_at = utcnow()
            await session.commit()
    logger.info("Chained %s job %s for source %s", kind, job_id, source_id)
    return job_id
