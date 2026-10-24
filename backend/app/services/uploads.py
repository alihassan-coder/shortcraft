"""Upload flow: register a Source, hand out an upload target, then confirm completion.

Small files (and every file with LocalStorage) use one PUT. With R2, files above
`multipart_threshold_bytes` use S3 multipart: the client PUTs each part to its presigned URL
and sends the part ETags to `complete`.
"""

import uuid
from collections.abc import Callable, Sequence

from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import Settings
from app.core.errors import (
    AppError,
    ConflictError,
    NotFoundError,
    PayloadTooLargeError,
    StorageError,
)
from app.db.models import Source
from app.schemas.upload import (
    CompletedPart,
    MultipartUploadTarget,
    SingleUploadTarget,
    UploadCreate,
)
from app.services.job_queue import JobQueue
from app.services.jobs import create_job
from app.services.projects import get_project
from app.services.storage import SOURCE_ARTIFACTS, StorageAdapter, source_key


def use_multipart(storage: StorageAdapter, size_bytes: int, settings: Settings) -> bool:
    return storage.supports_multipart and size_bytes > settings.multipart_threshold_bytes


async def create_upload(
    session: AsyncSession,
    storage: StorageAdapter,
    project_id: uuid.UUID,
    data: UploadCreate,
    *,
    settings: Settings,
    upload_url_for: Callable[[Source], str],
) -> tuple[Source, SingleUploadTarget | MultipartUploadTarget]:
    await get_project(session, project_id)
    max_bytes = settings.max_upload_bytes
    if data.size_bytes > max_bytes:
        raise PayloadTooLargeError(f"Uploads are limited to {max_bytes} bytes")
    source_id = uuid.uuid4()
    source = Source(
        id=source_id,
        project_id=project_id,
        filename=data.filename,
        content_type=data.content_type,
        size_bytes=data.size_bytes,
        storage_key=source_key(project_id, source_id, data.content_type),
        status="pending",
    )
    target: SingleUploadTarget | MultipartUploadTarget
    if use_multipart(storage, data.size_bytes, settings):
        target = await storage.create_multipart_upload(
            source.storage_key,
            source.content_type,
            data.size_bytes,
            settings.multipart_part_size_bytes,
        )
        source.upload_id = target.upload_id
    else:
        target = await storage.create_upload_target(
            source.storage_key, source.content_type, upload_url_for(source)
        )
    session.add(source)
    await session.commit()
    return source, target


async def get_source(session: AsyncSession, project_id: uuid.UUID, source_id: uuid.UUID) -> Source:
    source = await session.get(Source, source_id)
    if source is None or source.project_id != project_id:
        raise NotFoundError("Source not found")
    return source


async def complete_upload(
    session: AsyncSession,
    storage: StorageAdapter,
    project_id: uuid.UUID,
    source_id: uuid.UUID,
    *,
    max_bytes: int,
    parts: Sequence[CompletedPart] | None = None,
    proxy_queue: JobQueue | None = None,
) -> Source:
    """Mark a source uploaded once its bytes exist in storage (checked with HEAD).

    Multipart uploads are finalized first. With `proxy_queue`, a `proxy` job is created and
    enqueued the first time the upload completes. Idempotent: completing twice is fine.
    """
    source = await get_source(session, project_id, source_id)
    if source.has_file:
        return source
    if source.status == "aborted":
        raise ConflictError("This upload was aborted; start a new upload")

    if source.upload_id:
        if not parts:
            raise AppError("Multipart uploads need the list of parts", code="parts_required")
        try:
            await storage.complete_multipart_upload(source.storage_key, source.upload_id, parts)
        except StorageError:
            # A retry after a successful complete gets NoSuchUpload; the HEAD below decides.
            if not await storage.exists(source.storage_key):
                raise

    info = await storage.head(source.storage_key)
    if info is None:
        raise AppError("File has not been uploaded yet", code="upload_incomplete")
    if info.size > max_bytes:
        await storage.delete(source.storage_key)
        source.status = "aborted"
        source.upload_id = None
        await session.commit()
        raise PayloadTooLargeError(f"Uploads are limited to {max_bytes} bytes")

    source.size_bytes = info.size
    source.upload_id = None
    source.status = "uploaded"
    await session.commit()
    if proxy_queue is not None:
        await create_job(session, proxy_queue, project_id, "proxy", source_id=source.id)
    return source


async def abort_upload(
    session: AsyncSession, storage: StorageAdapter, project_id: uuid.UUID, source_id: uuid.UUID
) -> Source:
    """Cancel a pending upload and remove any stored bytes. Idempotent."""
    source = await get_source(session, project_id, source_id)
    if source.status == "aborted":
        return source
    if source.has_file:
        raise ConflictError("Upload is already complete")
    if source.upload_id:
        await storage.abort_multipart_upload(source.storage_key, source.upload_id)
    await storage.delete(source.storage_key)
    source.status = "aborted"
    source.upload_id = None
    await session.commit()
    return source


async def source_url(
    session: AsyncSession,
    storage: StorageAdapter,
    project_id: uuid.UUID,
    source_id: uuid.UUID,
    *,
    local_url: str,
) -> tuple[str, int | None]:
    source = await get_source(session, project_id, source_id)
    if not source.has_file:
        raise NotFoundError("Source has not been uploaded yet")
    return await storage.download_url(
        source.storage_key,
        filename=source.filename,
        content_type=source.content_type,
        local_url=local_url,
    )


ARTIFACT_FIELDS: dict[str, str] = {
    "proxy": "proxy-720p.mp4",
    "audio": "audio-16k.wav",
    "sprite": "sprite.jpg",
    "sprite_index": "sprite.json",
    "peaks": "peaks.json",
}
"""Response field -> artifact file name."""


def artifact_key(source: Source, name: str) -> str | None:
    return {
        "proxy-720p.mp4": source.proxy_key,
        "audio-16k.wav": source.audio_key,
        "sprite.jpg": source.sprite_key,
        "sprite.json": source.sprite_index_key,
        "peaks.json": source.peaks_key,
    }[name]


async def artifact_urls(
    storage: StorageAdapter, source: Source, *, local_url_for: Callable[[str], str]
) -> dict[str, tuple[str, int | None] | None]:
    """Playback/download URL for each artifact the proxy job made (None if not made)."""
    urls: dict[str, tuple[str, int | None] | None] = {}
    for field, name in ARTIFACT_FIELDS.items():
        key = artifact_key(source, name)
        urls[field] = (
            await storage.download_url(
                key,
                filename=name,
                content_type=SOURCE_ARTIFACTS[name],
                local_url=local_url_for(name),
            )
            if key
            else None
        )
    return urls
