from dataclasses import dataclass

from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from app.core.config import Settings
from app.media import MediaTools
from app.services.storage import StorageAdapter


@dataclass(frozen=True, slots=True)
class JobContext:
    """What a job needs. Built by the API lifespan (in-process) or the arq worker startup."""

    settings: Settings
    sessionmaker: async_sessionmaker[AsyncSession]
    storage: StorageAdapter

    @property
    def tools(self) -> MediaTools:
        return MediaTools(ffmpeg=self.settings.ffmpeg_path, ffprobe=self.settings.ffprobe_path)
