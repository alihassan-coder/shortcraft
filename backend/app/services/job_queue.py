"""Job queue behind a small interface.

- `ArqJobQueue`: arq + Redis. The API only enqueues the job id; `app.worker.main` runs it.
- `InProcessJobQueue`: no Redis needed. Runs jobs as asyncio tasks inside the API process
  (dev and tests). Jobs still running at shutdown are cancelled and marked failed.

Both execute `app.worker.runner.run_job`, which owns the job row's lifecycle.
"""

import asyncio
import dataclasses
import logging
import uuid
from typing import TYPE_CHECKING, Protocol

from app.core.config import Settings
from app.worker.context import JobContext
from app.worker.runner import ARQ_TASK, run_job

if TYPE_CHECKING:
    from arq.connections import ArqRedis

logger = logging.getLogger(__name__)


class JobQueue(Protocol):
    async def enqueue(self, job_id: uuid.UUID, kind: str) -> None: ...

    async def aclose(self) -> None: ...


class InProcessJobQueue:
    def __init__(self, ctx: JobContext | None = None, *, concurrency: int = 2) -> None:
        # Jobs run here can chain follow-up jobs (proxy -> transcribe -> plan) on this queue.
        if ctx is not None and ctx.enqueue is None:
            ctx = dataclasses.replace(ctx, enqueue=self.enqueue)
        self.ctx = ctx
        self._limit = asyncio.Semaphore(concurrency)
        self._tasks: set[asyncio.Task[None]] = set()

    async def enqueue(self, job_id: uuid.UUID, kind: str) -> None:
        if self.ctx is None:
            logger.info("Job %s (%s) queued; no job context, not running it", job_id, kind)
            return
        task = asyncio.create_task(self._run(job_id), name=f"job-{job_id}")
        self._tasks.add(task)
        task.add_done_callback(self._tasks.discard)

    async def _run(self, job_id: uuid.UUID) -> None:
        assert self.ctx is not None
        async with self._limit:
            try:
                await run_job(self.ctx, job_id)
            except asyncio.CancelledError:
                raise
            except Exception:  # run_job records failures itself; this is a last resort
                logger.exception("In-process job %s crashed", job_id)

    async def join(self) -> None:
        """Wait for every job enqueued so far (tests, graceful shutdown)."""
        while self._tasks:
            await asyncio.gather(*self._tasks, return_exceptions=True)

    async def aclose(self) -> None:
        for task in list(self._tasks):
            task.cancel()
        await asyncio.gather(*self._tasks, return_exceptions=True)


class ArqJobQueue:
    """Enqueues `run_job(job_id)` on Redis. The arq job id is the Job id, so a duplicate
    enqueue of the same job is a no-op."""

    def __init__(self, redis_url: str, *, pool: ArqRedis | None = None) -> None:
        self.redis_url = redis_url
        self._pool = pool
        self._owns_pool = pool is None
        self._lock = asyncio.Lock()

    async def _get_pool(self) -> ArqRedis:
        async with self._lock:
            if self._pool is None:
                from arq import create_pool
                from arq.connections import RedisSettings

                self._pool = await create_pool(RedisSettings.from_dsn(self.redis_url))
            return self._pool

    async def enqueue(self, job_id: uuid.UUID, kind: str) -> None:
        pool = await self._get_pool()
        await pool.enqueue_job(ARQ_TASK, str(job_id), _job_id=str(job_id))
        logger.info("Job %s (%s) sent to arq", job_id, kind)

    async def aclose(self) -> None:
        if self._pool is not None and self._owns_pool:
            await self._pool.aclose()
        self._pool = None


def build_job_queue(settings: Settings, ctx: JobContext | None = None) -> JobQueue:
    if settings.use_arq:
        if not settings.redis_url:
            raise RuntimeError("JOB_QUEUE_BACKEND=arq needs REDIS_URL")
        return ArqJobQueue(settings.redis_url)
    return InProcessJobQueue(ctx, concurrency=settings.worker_concurrency)
