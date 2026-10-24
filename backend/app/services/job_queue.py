"""Job queue behind a small interface. In-process no-op now; arq + Redis later."""

import logging
import uuid
from typing import Protocol

from app.core.config import Settings

logger = logging.getLogger(__name__)


class JobQueue(Protocol):
    async def enqueue(self, job_id: uuid.UUID, kind: str) -> None: ...


class InProcessJobQueue:
    """Runs nothing: jobs stay `queued` until a real worker exists."""

    async def enqueue(self, job_id: uuid.UUID, kind: str) -> None:
        logger.info("Job %s (%s) queued; no worker configured", job_id, kind)


def build_job_queue(settings: Settings) -> JobQueue:
    # TODO: ArqJobQueue(settings.redis_url) once the worker exists.
    return InProcessJobQueue()
