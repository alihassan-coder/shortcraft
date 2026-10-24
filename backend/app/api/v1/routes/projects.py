import uuid

from fastapi import APIRouter, Query, Response, status

from app.api.deps import CurrentUserDep, SessionDep, StorageDep
from app.schemas.project import ProjectCreate, ProjectRead, ProjectUpdate
from app.services import projects as service

router = APIRouter(prefix="/projects", tags=["projects"])


@router.get("", response_model=list[ProjectRead])
async def list_projects(
    session: SessionDep,
    limit: int = Query(50, ge=1, le=200),
    offset: int = Query(0, ge=0),
):
    return await service.list_projects(session, limit=limit, offset=offset)


@router.post("", response_model=ProjectRead, status_code=status.HTTP_201_CREATED)
async def create_project(data: ProjectCreate, session: SessionDep, user: CurrentUserDep):
    # Auth is optional for now: signed-in users become the owner, anonymous projects have none.
    return await service.create_project(session, data, owner_id=user.id if user else None)


@router.get("/{project_id}", response_model=ProjectRead)
async def get_project(project_id: uuid.UUID, session: SessionDep):
    return await service.get_project(session, project_id)


@router.patch("/{project_id}", response_model=ProjectRead)
async def update_project(project_id: uuid.UUID, data: ProjectUpdate, session: SessionDep):
    return await service.update_project(session, project_id, data)


@router.delete("/{project_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_project(project_id: uuid.UUID, session: SessionDep, storage: StorageDep):
    await service.delete_project(session, storage, project_id)
    return Response(status_code=status.HTTP_204_NO_CONTENT)
