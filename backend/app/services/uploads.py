"""Upload flow: register a Source, hand out an upload target, then confirm completion."""

import uuid
from collections.abc import Callable

from sqlalchemy.ext.asyncio import AsyncSession

from app.core.errors import AppError, NotFoundError, PayloadTooLargeError
from app.db.models import Source
from app.schemas.upload import UploadCreate, UploadTarget
from app.services.projects import get_project
from app.services.storage import StorageAdapter, safe_filename


async def create_upload(
    session: AsyncSession,
    storage: StorageAdapter,
    project_id: uuid.UUID,
    data: UploadCreate,
    *,
    max_bytes: int,
    upload_url_for: Callable[[Source], str],
) -> tuple[Source, UploadTarget]:
    await get_project(session, project_id)
    if data.size_bytes > max_bytes:
        raise PayloadTooLargeError(f"Uploads are limited to {max_bytes} bytes")
    source_id = uuid.uuid4()
    source = Source(
        id=source_id,
        project_id=project_id,
        filename=data.filename,
        content_type=data.content_type,
        size_bytes=data.size_bytes,
        storage_key=f"projects/{project_id}/sources/{source_id}/{safe_filename(data.filename)}",
        status="pending",
    )
    session.add(source)
    await session.commit()
    target = await storage.create_upload_target(
        source.storage_key, source.content_type, upload_url_for(source)
    )
    return source, target


async def get_source(session: AsyncSession, project_id: uuid.UUID, source_id: uuid.UUID) -> Source:
    source = await session.get(Source, source_id)
    if source is None or source.project_id != project_id:
        raise NotFoundError("Source not found")
    return source


async def complete_upload(
    session: AsyncSession, storage: StorageAdapter, project_id: uuid.UUID, source_id: uuid.UUID
) -> Source:
    """Mark a source uploaded once its bytes exist in storage. Idempotent."""
    source = await get_source(session, project_id, source_id)
    if source.status != "uploaded":
        if not await storage.exists(source.storage_key):
            raise AppError("File has not been uploaded yet", code="upload_incomplete")
        source.status = "uploaded"
        await session.commit()
    return source
