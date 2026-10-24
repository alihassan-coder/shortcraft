import uuid

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.errors import NotFoundError
from app.db.models import Project, Source
from app.schemas.project import ProjectCreate, ProjectUpdate
from app.services.storage import StorageAdapter


async def list_projects(session: AsyncSession, *, limit: int, offset: int) -> list[Project]:
    stmt = select(Project).order_by(Project.created_at.desc()).limit(limit).offset(offset)
    return list(await session.scalars(stmt))


async def get_project(session: AsyncSession, project_id: uuid.UUID) -> Project:
    project = await session.get(Project, project_id)
    if project is None:
        raise NotFoundError("Project not found")
    return project


async def create_project(
    session: AsyncSession, data: ProjectCreate, *, owner_id: uuid.UUID | None = None
) -> Project:
    project = Project(title=data.title, owner_id=owner_id)
    session.add(project)
    await session.commit()
    return project


async def update_project(
    session: AsyncSession, project_id: uuid.UUID, data: ProjectUpdate
) -> Project:
    project = await get_project(session, project_id)
    project.title = data.title
    await session.commit()
    return project


async def delete_project(
    session: AsyncSession, storage: StorageAdapter, project_id: uuid.UUID
) -> None:
    project = await get_project(session, project_id)
    sources = await session.scalars(select(Source).filter_by(project_id=project_id))
    keys = [key for source in sources for key in source.stored_keys()]
    await session.delete(project)
    await session.commit()
    for key in keys:
        await storage.delete(key)
