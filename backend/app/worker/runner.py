"""Job lifecycle on the `jobs` row: queued -> running -> succeeded | failed.

`run_job` is what both queues execute (asyncio task in-process, or the arq worker). It is safe
to call twice: finished jobs are skipped, and a job left `running` by a crashed worker runs
again.
"""

import asyncio
import logging
import uuid
from collections.abc import Awaitable, Callable
from typing import Any

from sqlalchemy import update

from app.core.errors import AppError
from app.db.base import utcnow
from app.db.models import Job
from app.media import MediaError
from app.worker.context import JobContext, JobFailedError, Progress
from app.worker.plan import run_plan
from app.worker.proxy import run_proxy
from app.worker.transcribe import run_transcribe

logger = logging.getLogger(__name__)

ARQ_TASK = "run_job"
TERMINAL_STATUSES = frozenset({"succeeded", "failed"})
MAX_ERROR_LENGTH = 2000

Handler = Callable[[JobContext, Job, Progress], Awaitable[dict[str, Any]]]

# Job kinds that have a worker today. Other kinds are created as `queued` and wait.
HANDLERS: dict[str, Handler] = {
    "proxy": run_proxy,
    "transcribe": run_transcribe,
    "plan": run_plan,
}


def has_handler(kind: str) -> bool:
    return kind in HANDLERS


def _user_message(exc: BaseException) -> str:
    if isinstance(exc, AppError):
        return exc.message
    if isinstance(exc, (JobFailedError, MediaError)):
        return str(exc) or type(exc).__name__
    return f"Internal error ({type(exc).__name__})"


async def _set(ctx: JobContext, job_id: uuid.UUID, **values: Any) -> None:
    async with ctx.sessionmaker() as session:
        await session.execute(
            update(Job).where(Job.id == job_id).values(**values, updated_at=utcnow())
        )
        await session.commit()


async def run_job(ctx: JobContext, job_id: uuid.UUID) -> None:
    async with ctx.sessionmaker() as session:
        job = await session.get(Job, job_id)
        if job is None:
            logger.warning("Job %s not found; skipping", job_id)
            return
        if job.status in TERMINAL_STATUSES:
            logger.info("Job %s already %s; skipping", job_id, job.status)
            return
        handler = HANDLERS.get(job.kind)
        if handler is None:
            logger.warning("No handler for %s job %s", job.kind, job_id)
            return
        job.status = "running"
        job.progress = 0
        job.error = None
        job.started_at = utcnow()
        job.finished_at = None
        await session.commit()

    last = 0

    async def progress(value: int) -> None:
        nonlocal last
        value = max(last, min(99, int(value)))  # never goes back; 100 only on success
        if value != last:
            last = value
            await _set(ctx, job_id, progress=value)

    logger.info("Job %s (%s) started", job_id, job.kind)
    try:
        result = await handler(ctx, job, progress)
    except asyncio.CancelledError:
        await asyncio.shield(
            _set(ctx, job_id, status="failed", error="Job was interrupted", finished_at=utcnow())
        )
        raise
    except Exception as exc:
        if isinstance(exc, (AppError, JobFailedError, MediaError)):
            logger.warning("Job %s (%s) failed: %s", job_id, job.kind, exc)
        else:
            logger.exception("Job %s (%s) crashed", job_id, job.kind)
        await _set(
            ctx,
            job_id,
            status="failed",
            error=_user_message(exc)[:MAX_ERROR_LENGTH],
            finished_at=utcnow(),
        )
        return
    await _set(ctx, job_id, status="succeeded", progress=100, result=result, finished_at=utcnow())
    logger.info("Job %s (%s) succeeded", job_id, job.kind)
