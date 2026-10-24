"""FastAPI dependencies. Shared resources live on `app.state`, built once in the lifespan."""

from collections.abc import AsyncIterator
from typing import Annotated

from fastapi import Depends, Request
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.auth import CurrentUser, TokenVerifier
from app.core.config import Settings
from app.core.errors import UnauthorizedError
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


_bearer = HTTPBearer(auto_error=False)


async def get_current_user(
    request: Request,
    credentials: Annotated[HTTPAuthorizationCredentials | None, Depends(_bearer)],
) -> CurrentUser | None:
    """The Supabase user behind `Authorization: Bearer <jwt>`, or None (anonymous).

    Anonymous requests are allowed while AUTH_REQUIRED=false. A token that is present but
    invalid or expired is always rejected with 401.
    """
    settings: Settings = request.app.state.settings
    verifier: TokenVerifier = request.app.state.token_verifier
    if credentials is None or not verifier.configured:
        if settings.auth_required:
            raise UnauthorizedError("Sign in required")
        return None
    return await verifier.verify(credentials.credentials)


SettingsDep = Annotated[Settings, Depends(get_settings)]
SessionDep = Annotated[AsyncSession, Depends(get_session)]
StorageDep = Annotated[StorageAdapter, Depends(get_storage)]
JobQueueDep = Annotated[JobQueue, Depends(get_job_queue)]
CurrentUserDep = Annotated[CurrentUser | None, Depends(get_current_user)]
