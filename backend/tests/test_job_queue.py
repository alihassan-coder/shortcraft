"""Queue adapters: selection, arq enqueue/serialization (fakeredis), and the arq worker entry."""

import uuid
from collections.abc import AsyncIterator
from pathlib import Path
from typing import Any

import arq.worker
import fakeredis
import pytest
from arq.connections import ArqRedis
from arq.jobs import Job as ArqJob
from arq.worker import Worker
from fakeredis.aioredis import FakeAsyncRedisConnection
from redis.asyncio import ConnectionPool

from app.db.base import Base
from app.db.models import Job, Project
from app.db.session import create_engine, create_sessionmaker
from app.services.job_queue import ArqJobQueue, InProcessJobQueue, build_job_queue
from app.services.storage import LocalStorage
from app.worker import main as worker_main
from app.worker import runner
from app.worker.context import JobContext, Progress
from tests.conftest import make_settings

pytestmark = pytest.mark.unit


@pytest.fixture
async def redis_pool() -> AsyncIterator[ArqRedis]:
    pool = ArqRedis(
        connection_pool=ConnectionPool(
            connection_class=FakeAsyncRedisConnection, server=fakeredis.FakeServer()
        )
    )
    yield pool
    await pool.aclose()


@pytest.fixture
async def job_ctx(tmp_path: Path) -> AsyncIterator[JobContext]:
    settings = make_settings(
        tmp_path, database_url=f"sqlite+aiosqlite:///{(tmp_path / 'q.db').as_posix()}"
    )
    engine = create_engine(settings.database_url)
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    yield JobContext(settings, create_sessionmaker(engine), LocalStorage(tmp_path / "files"))
    await engine.dispose()


async def _new_job(ctx: JobContext, kind: str = "proxy") -> uuid.UUID:
    async with ctx.sessionmaker() as session:
        project = Project(title="q")
        session.add(project)
        await session.flush()
        job = Job(project_id=project.id, kind=kind, status="queued")
        session.add(job)
        await session.commit()
        return job.id


async def _load(ctx: JobContext, job_id: uuid.UUID) -> Job:
    async with ctx.sessionmaker() as session:
        job = await session.get(Job, job_id)
        assert job is not None
        return job


# --- selection ---------------------------------------------------------------------------------


@pytest.mark.parametrize(
    ("overrides", "expected"),
    [
        ({"job_queue_backend": "auto", "redis_url": None}, InProcessJobQueue),
        ({"job_queue_backend": "auto", "redis_url": "redis://localhost:6379/0"}, ArqJobQueue),
        ({"job_queue_backend": "inprocess", "redis_url": "redis://x:6379/0"}, InProcessJobQueue),
        ({"job_queue_backend": "arq", "redis_url": "redis://x:6379/0"}, ArqJobQueue),
    ],
)
def test_build_job_queue_selection(
    tmp_path: Path, overrides: dict[str, Any], expected: type
) -> None:
    queue = build_job_queue(make_settings(tmp_path, **overrides))
    assert isinstance(queue, expected)


def test_arq_backend_without_redis_url_is_an_error(tmp_path: Path) -> None:
    with pytest.raises(RuntimeError, match="REDIS_URL"):
        build_job_queue(make_settings(tmp_path, job_queue_backend="arq", redis_url=None))


def test_worker_settings_are_importable() -> None:
    settings = worker_main.WorkerSettings
    assert [f.name for f in settings.functions] == [runner.ARQ_TASK]
    assert settings.on_startup is worker_main.startup
    assert settings.max_jobs >= 1


# --- arq ---------------------------------------------------------------------------------------


async def test_arq_enqueue_serializes_job_id(redis_pool: ArqRedis) -> None:
    queue = ArqJobQueue("redis://unused", pool=redis_pool)
    job_id = uuid.uuid4()
    await queue.enqueue(job_id, "proxy")

    assert await redis_pool.zrange("arq:queue", 0, -1) == [str(job_id).encode()]
    info = await ArqJob(str(job_id), redis_pool).info()
    assert info is not None
    assert info.function == runner.ARQ_TASK
    assert info.args == (str(job_id),)

    # Same job id again: arq de-duplicates, still one entry.
    await queue.enqueue(job_id, "proxy")
    assert await redis_pool.zcard("arq:queue") == 1
    await queue.aclose()  # injected pool is not closed by the queue
    assert await redis_pool.ping()


async def test_arq_worker_runs_job_lifecycle(
    redis_pool: ArqRedis, job_ctx: JobContext, monkeypatch: pytest.MonkeyPatch
) -> None:
    async def fake_proxy(ctx: JobContext, job: Job, progress: Progress) -> dict[str, Any]:
        await progress(50)
        return {"ok": True, "job": str(job.id)}

    async def no_redis_info(*_: Any, **__: Any) -> None:  # fakeredis has no INFO command
        return None

    monkeypatch.setitem(runner.HANDLERS, "proxy", fake_proxy)
    monkeypatch.setattr(arq.worker, "log_redis_info", no_redis_info)

    job_id = await _new_job(job_ctx)
    await ArqJobQueue("redis://unused", pool=redis_pool).enqueue(job_id, "proxy")

    async def startup(ctx: dict[str, Any]) -> None:
        ctx["job_ctx"] = job_ctx

    worker = Worker(
        functions=worker_main.WorkerSettings.functions,
        redis_pool=redis_pool,
        on_startup=startup,
        burst=True,
        poll_delay=0.01,
        handle_signals=False,
    )
    await worker.main()
    assert worker.jobs_complete == 1

    job = await _load(job_ctx, job_id)
    assert job.status == "succeeded"
    assert job.progress == 100
    assert job.result == {"ok": True, "job": str(job_id)}
    assert job.started_at is not None and job.finished_at is not None
    assert job.finished_at >= job.started_at


# --- runner + in-process -----------------------------------------------------------------------


async def test_in_process_queue_runs_and_records_failure(
    job_ctx: JobContext, monkeypatch: pytest.MonkeyPatch
) -> None:
    async def broken(ctx: JobContext, job: Job, progress: Progress) -> dict[str, Any]:
        await progress(30)
        raise RuntimeError("secret internals")

    monkeypatch.setitem(runner.HANDLERS, "proxy", broken)
    queue = InProcessJobQueue(job_ctx)
    job_id = await _new_job(job_ctx)
    await queue.enqueue(job_id, "proxy")
    await queue.join()

    job = await _load(job_ctx, job_id)
    assert job.status == "failed"
    assert job.error == "Internal error (RuntimeError)"  # no internals leak to the client
    assert job.progress == 30
    assert job.finished_at is not None


async def test_runner_skips_finished_jobs(job_ctx: JobContext) -> None:
    job_id = await _new_job(job_ctx)
    async with job_ctx.sessionmaker() as session:
        job = await session.get(Job, job_id)
        assert job is not None
        job.status = "succeeded"
        await session.commit()
    await runner.run_job(job_ctx, job_id)
    assert (await _load(job_ctx, job_id)).status == "succeeded"


async def test_kinds_without_worker_stay_queued(job_ctx: JobContext) -> None:
    job_id = await _new_job(job_ctx, kind="render")
    await runner.run_job(job_ctx, job_id)
    assert (await _load(job_ctx, job_id)).status == "queued"


async def test_in_process_queue_without_context_is_a_noop() -> None:
    queue = InProcessJobQueue(None)
    await queue.enqueue(uuid.uuid4(), "proxy")
    await queue.join()
    await queue.aclose()
