"""Uploads: 1) POST .../uploads -> target, 2) client PUTs bytes to target, 3) POST .../complete.

With LocalStorage the target is this API (PUT .../content). With R2 it will be a presigned URL;
the client flow stays the same.
"""

import uuid

from fastapi import APIRouter, Request, status
from fastapi.responses import FileResponse

from app.api.deps import SessionDep, SettingsDep, StorageDep
from app.core.errors import NotFoundError
from app.db.models import Source
from app.schemas.upload import SourceRead, UploadCreate, UploadCreated
from app.services import uploads as service
from app.services.storage import LocalStorage, StorageAdapter

router = APIRouter(prefix="/projects/{project_id}", tags=["uploads"])


def _local(storage: StorageAdapter) -> LocalStorage:
    if not isinstance(storage, LocalStorage):
        raise NotFoundError("Direct content routes exist only for local storage")
    return storage


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
        path = request.app.url_path_for(
            "put_source_content", project_id=str(project_id), source_id=str(source.id)
        )
        return f"{settings.public_base_url.rstrip('/')}{path}"

    source, target = await service.create_upload(
        session,
        storage,
        project_id,
        data,
        max_bytes=settings.max_upload_bytes,
        upload_url_for=upload_url_for,
    )
    return UploadCreated(source=SourceRead.model_validate(source), upload=target)


@router.put("/sources/{source_id}/content", name="put_source_content", response_model=SourceRead)
async def put_source_content(
    project_id: uuid.UUID,
    source_id: uuid.UUID,
    request: Request,
    session: SessionDep,
    storage: StorageDep,
):
    """LocalStorage upload target: receives the raw file body (streamed to disk)."""
    local = _local(storage)
    source = await service.get_source(session, project_id, source_id)
    await local.write(source.storage_key, request.stream(), max_bytes=source.size_bytes)
    return await service.complete_upload(session, storage, project_id, source_id)


@router.post("/sources/{source_id}/complete", response_model=SourceRead)
async def complete_upload(
    project_id: uuid.UUID, source_id: uuid.UUID, session: SessionDep, storage: StorageDep
):
    return await service.complete_upload(session, storage, project_id, source_id)


@router.get("/sources/{source_id}/content", response_class=FileResponse)
async def get_source_content(
    project_id: uuid.UUID, source_id: uuid.UUID, session: SessionDep, storage: StorageDep
):
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
