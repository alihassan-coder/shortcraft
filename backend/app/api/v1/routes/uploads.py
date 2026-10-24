"""Uploads.

1. POST .../uploads -> {source, upload}. `upload.mode` is:
   - "single": PUT the whole file to `upload.url` with `upload.headers`.
   - "multipart" (R2, big files): PUT each `partSize` slice to `parts[i].url`, keep each
     response's `ETag` header.
2. POST .../sources/{sid}/complete (body `{"parts": [{"partNumber", "etag"}]}` for multipart).
3. GET .../sources/{sid}/url -> where to play/download it.

POST .../sources/{sid}/abort cancels a pending upload.

With LocalStorage the single-PUT target is this API (PUT .../content). With R2 every URL is
presigned, so bytes go straight between the browser and the bucket.
"""

import uuid

from fastapi import APIRouter, Request, status
from fastapi.responses import FileResponse

from app.api.deps import SessionDep, SettingsDep, StorageDep
from app.core.errors import NotFoundError
from app.db.models import Source
from app.schemas.upload import SourceRead, SourceUrl, UploadComplete, UploadCreate, UploadCreated
from app.services import uploads as service
from app.services.storage import LocalStorage, StorageAdapter

router = APIRouter(prefix="/projects/{project_id}", tags=["uploads"])


def _local(storage: StorageAdapter) -> LocalStorage:
    if not isinstance(storage, LocalStorage):
        raise NotFoundError("Direct content routes exist only for local storage")
    return storage


def _absolute(request: Request, base_url: str, name: str, **params: str) -> str:
    return f"{base_url.rstrip('/')}{request.app.url_path_for(name, **params)}"


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
):
    """LocalStorage upload target: receives the raw file body (streamed to disk)."""
    local = _local(storage)
    source = await service.get_source(session, project_id, source_id)
    await local.write(source.storage_key, request.stream(), max_bytes=source.size_bytes)
    return await service.complete_upload(
        session, storage, project_id, source_id, max_bytes=settings.max_upload_bytes
    )


@router.post("/sources/{source_id}/complete", response_model=SourceRead)
async def complete_upload(
    project_id: uuid.UUID,
    source_id: uuid.UUID,
    session: SessionDep,
    storage: StorageDep,
    settings: SettingsDep,
    data: UploadComplete | None = None,
):
    return await service.complete_upload(
        session,
        storage,
        project_id,
        source_id,
        max_bytes=settings.max_upload_bytes,
        parts=data.parts if data else None,
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
    if source.status != "uploaded":
        raise NotFoundError("Source has not been uploaded yet")
    return FileResponse(
        local.path_for(source.storage_key),
        media_type=source.content_type,
        filename=source.filename,
        content_disposition_type="inline",
    )
