import uuid
from collections.abc import Awaitable, Callable
from dataclasses import dataclass

from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from app.ai.models import AgentModels
from app.core.config import Settings
from app.media import MediaTools
from app.services.storage import StorageAdapter
from app.transcription import TranscriptionProvider, build_provider

Enqueue = Callable[[uuid.UUID, str], Awaitable[None]]
"""Send an existing job row to the queue (the queue's `enqueue`)."""


@dataclass(frozen=True, slots=True)
class JobContext:
    """What a job needs. Built by the API lifespan (in-process) or the arq worker startup."""

    settings: Settings
    sessionmaker: async_sessionmaker[AsyncSession]
    storage: StorageAdapter
    # Lets a job start the next one (proxy -> transcribe -> plan). None = no chaining.
    enqueue: Enqueue | None = None
    # Override the speech-to-text provider (tests); None = built from settings.
    transcriber: TranscriptionProvider | None = None
    # Override the AI agents' chat models (tests); None = OpenAI models from settings.
    agent_models: AgentModels | None = None

    @property
    def tools(self) -> MediaTools:
        return MediaTools(ffmpeg=self.settings.ffmpeg_path, ffprobe=self.settings.ffprobe_path)

    def transcription_provider(self) -> TranscriptionProvider:
        return self.transcriber or build_provider(self.settings)

    def ai_models(self) -> AgentModels:
        return self.agent_models or AgentModels(self.settings)


Progress = Callable[[int], Awaitable[None]]
"""Report job progress (0-100). Each call writes the value to the job row."""


class JobFailedError(Exception):
    """A job failed for a reason worth showing to the user as-is."""
