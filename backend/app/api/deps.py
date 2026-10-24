"""FastAPI dependencies. Shared resources live on `app.state`, built once in the lifespan."""

from collections.abc import AsyncIterator
from typing import Annotated

from fastapi import Depends, Request
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import Settings
from app.services.job_queue import JobQueue
from app.services.storage import StorageAdapter


def get_settings(request: Request) -> Settings:
    return request.app.state.settings


async def get_session(request: Request) -> AsyncIterator[AsyncSession]:
    async with request.app.state.sessionmaker() as session:
        yield session


def get_storage(request: Request) -> StorageAdapter:
    return request.app.state.storage


def get_job_queue(request: Request) -> JobQueue:
    return request.app.state.job_queue


SettingsDep = Annotated[Settings, Depends(get_settings)]
SessionDep = Annotated[AsyncSession, Depends(get_session)]
StorageDep = Annotated[StorageAdapter, Depends(get_storage)]
JobQueueDep = Annotated[JobQueue, Depends(get_job_queue)]
