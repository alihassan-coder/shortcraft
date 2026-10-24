"""Uploads.

1. POST .../uploads -> {source, upload}. `upload.mode` is:
   - "single": PUT the whole file to `upload.url` with `upload.headers`.
   - "multipart" (R2, big files): PUT each `partSize` slice to `parts[i].url`, keep each
     response's `ETag` header.
2. POST .../sources/{sid}/complete (body `{"parts": [{"partNumber", "etag"}]}` for multipart).
   This also enqueues a `proxy` job (720p preview, audio, thumbnails, waveform).
3. GET .../sources/{sid}/url -> where to play/download it.
4. GET .../sources/{sid} -> metadata, artifact URLs and the latest proxy job.

POST .../sources/{sid}/abort cancels a pending upload.

With LocalStorage the single-PUT target is this API (PUT .../content). With R2 every URL is
presigned, so bytes go straight between the browser and the bucket.
"""

import uuid

from fastapi import APIRouter, Request, status
from fastapi.responses import FileResponse

from app.api.deps import JobQueueDep, SessionDep, SettingsDep, StorageDep
from app.core.config import Settings
from app.core.errors import ConflictError, NotFoundError
from app.db.models import Source
from app.schemas.job import JobRead
from app.schemas.upload import (
    SourceDetail,
    SourceRead,
    SourceUrl,
    SourceUrls,
    UploadComplete,
    UploadCreate,
    UploadCreated,
)
from app.services import jobs as jobs_service
from app.services import uploads as service
from app.services.job_queue import JobQueue
from app.services.storage import SOURCE_ARTIFACTS, LocalStorage, StorageAdapter

router = APIRouter(prefix="/projects/{project_id}", tags=["uploads"])


def _local(storage: StorageAdapter) -> LocalStorage:
    if not isinstance(storage, LocalStorage):
        raise NotFoundError("Direct content routes exist only for local storage")
    return storage


def _absolute(request: Request, base_url: str, name: str, **params: str) -> str:
    return f"{base_url.rstrip('/')}{request.app.url_path_for(name, **params)}"


def _proxy_queue(settings: Settings, queue: JobQueue) -> JobQueue | None:
    return queue if settings.proxy_on_upload else None


@router.post("/uploads", response_model=UploadCreated, status_code=status.HTTP_201_CREATED)
async def create_upload(
    project_id: uuid.UUID,
    data: UploadCreate,
    request: Request,
    session: SessionDep,
    storage: StorageDep,
    settings: SettingsDep,
):
    def upload_url_for(source: Source) -> str:
        return _absolute(
            request,
            settings.public_base_url,
            "put_source_content",
            project_id=str(project_id),
            source_id=str(source.id),
        )

    source, target = await service.create_upload(
        session, storage, project_id, data, settings=settings, upload_url_for=upload_url_for
    )
    return UploadCreated(source=SourceRead.model_validate(source), upload=target)


@router.put("/sources/{source_id}/content", name="put_source_content", response_model=SourceRead)
async def put_source_content(
    project_id: uuid.UUID,
    source_id: uuid.UUID,
    request: Request,
    session: SessionDep,
    storage: StorageDep,
    settings: SettingsDep,
    queue: JobQueueDep,
):
    """LocalStorage upload target: receives the raw file body (streamed to disk)."""
    local = _local(storage)
    source = await service.get_source(session, project_id, source_id)
    if source.has_file:
        raise ConflictError("Upload is already complete")
    await local.write(source.storage_key, request.stream(), max_bytes=source.size_bytes)
    return await service.complete_upload(
        session,
        storage,
        project_id,
        source_id,
        max_bytes=settings.max_upload_bytes,
        proxy_queue=_proxy_queue(settings, queue),
    )


@router.post("/sources/{source_id}/complete", response_model=SourceRead)
async def complete_upload(
    project_id: uuid.UUID,
    source_id: uuid.UUID,
    session: SessionDep,
    storage: StorageDep,
    settings: SettingsDep,
    queue: JobQueueDep,
    data: UploadComplete | None = None,
):
    return await service.complete_upload(
        session,
        storage,
        project_id,
        source_id,
        max_bytes=settings.max_upload_bytes,
        parts=data.parts if data else None,
        proxy_queue=_proxy_queue(settings, queue),
    )


@router.post("/sources/{source_id}/abort", response_model=SourceRead)
async def abort_upload(
    project_id: uuid.UUID, source_id: uuid.UUID, session: SessionDep, storage: StorageDep
):
    return await service.abort_upload(session, storage, project_id, source_id)


@router.get("/sources/{source_id}/url", response_model=SourceUrl)
async def get_source_url(
    project_id: uuid.UUID,
    source_id: uuid.UUID,
    request: Request,
    session: SessionDep,
    storage: StorageDep,
    settings: SettingsDep,
):
    """Playback/download URL. R2: presigned GET (short-lived). Local: the content route."""
    local_url = _absolute(
        request,
        settings.public_base_url,
        "get_source_content",
        project_id=str(project_id),
        source_id=str(source_id),
    )
    url, expires_in = await service.source_url(
        session, storage, project_id, source_id, local_url=local_url
    )
    return SourceUrl(url=url, expires_in=expires_in)


@router.get("/sources/{source_id}/content", name="get_source_content", response_class=FileResponse)
async def get_source_content(
    project_id: uuid.UUID, source_id: uuid.UUID, session: SessionDep, storage: StorageDep
):
    """LocalStorage only: serves the video (supports Range requests)."""
    local = _local(storage)
    source = await service.get_source(session, project_id, source_id)
    if not source.has_file:
        raise NotFoundError("Source has not been uploaded yet")
    return FileResponse(
        local.path_for(source.storage_key),
        media_type=source.content_type,
        filename=source.filename,
        content_disposition_type="inline",
    )


@router.get("/sources/{source_id}", response_model=SourceDetail)
async def get_source(
    project_id: uuid.UUID,
    source_id: uuid.UUID,
    request: Request,
    session: SessionDep,
    storage: StorageDep,
    settings: SettingsDep,
):
    """Metadata (filled by the proxy job), URLs of the original and of every artifact, and the
    latest proxy job. R2 URLs are presigned (short-lived); local URLs point at this API."""
    source = await service.get_source(session, project_id, source_id)
    ids = {"project_id": str(project_id), "source_id": str(source_id)}
    base = settings.public_base_url

    original = None
    if source.has_file:
        url, expires_in = await storage.download_url(
            source.storage_key,
            filename=source.filename,
            content_type=source.content_type,
            local_url=_absolute(request, base, "get_source_content", **ids),
        )
        original = SourceUrl(url=url, expires_in=expires_in)

    artifacts = await service.artifact_urls(
        storage,
        source,
        local_url_for=lambda name: _absolute(request, base, "get_source_file", name=name, **ids),
    )
    urls = SourceUrls(
        original=original,
        **{
            field: SourceUrl(url=value[0], expires_in=value[1]) if value else None
            for field, value in artifacts.items()
        },
    )
    job = await jobs_service.latest_job(session, project_id, source_id, "proxy")
    return SourceDetail(
        **SourceRead.model_validate(source).model_dump(),
        urls=urls,
        proxy_job=JobRead.model_validate(job) if job else None,
    )


@router.get(
    "/sources/{source_id}/files/{name}", name="get_source_file", response_class=FileResponse
)
async def get_source_file(
    project_id: uuid.UUID, source_id: uuid.UUID, name: str, session: SessionDep, storage: StorageDep
):
    """LocalStorage only: serves a proxy-job artifact (proxy-720p.mp4, audio-16k.wav,
    sprite.jpg, sprite.json, peaks.json)."""
    local = _local(storage)
    if name not in SOURCE_ARTIFACTS:
        raise NotFoundError("Unknown file")
    source = await service.get_source(session, project_id, source_id)
    key = service.artifact_key(source, name)
    if key is None:
        raise NotFoundError("File has not been made yet")
    return FileResponse(
        local.path_for(key), media_type=SOURCE_ARTIFACTS[name], content_disposition_type="inline"
    )
