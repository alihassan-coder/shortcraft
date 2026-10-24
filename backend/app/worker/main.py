"""arq worker entrypoint: `uv run arq app.worker.main.WorkerSettings` (needs REDIS_URL).

Uses the same settings/.env as the API (database, storage, ffmpeg paths).
"""

import uuid
from typing import Any, ClassVar

from arq.connections import RedisSettings
from arq.worker import Function, func

from app.ai.models import configure_tracing
from app.core.config import get_settings
from app.core.logging import configure_logging
from app.db.session import create_engine, create_sessionmaker
from app.services.job_queue import ArqJobQueue
from app.services.storage import build_storage
from app.worker.context import JobContext
from app.worker.runner import ARQ_TASK, run_job

DEFAULT_REDIS_URL = "redis://localhost:6379/0"


async def startup(ctx: dict[str, Any]) -> None:
    settings = get_settings()
    configure_logging(settings.log_level)
    configure_tracing(settings)
    engine = create_engine(settings.database_url, echo=settings.database_echo)
    ctx["engine"] = engine
    # Follow-up jobs (proxy -> transcribe -> plan) go back to Redis on arq's own pool.
    redis = ctx.get("redis")
    queue = ArqJobQueue(settings.redis_url or DEFAULT_REDIS_URL, pool=redis) if redis else None
    ctx["job_ctx"] = JobContext(
        settings=settings,
        sessionmaker=create_sessionmaker(engine),
        storage=build_storage(settings),
        enqueue=queue.enqueue if queue else None,
    )


async def shutdown(ctx: dict[str, Any]) -> None:
    engine = ctx.get("engine")
    if engine is not None:
        await engine.dispose()


async def run_job_task(ctx: dict[str, Any], job_id: str) -> None:
    await run_job(ctx["job_ctx"], uuid.UUID(job_id))


class WorkerSettings:
    _settings = get_settings()

    functions: ClassVar[list[Function]] = [func(run_job_task, name=ARQ_TASK)]
    on_startup = startup
    on_shutdown = shutdown
    redis_settings = RedisSettings.from_dsn(_settings.redis_url or DEFAULT_REDIS_URL)
    max_jobs = _settings.worker_concurrency
    job_timeout = _settings.job_timeout_seconds
