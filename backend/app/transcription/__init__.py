"""Speech to text: provider interface, Deepgram (REST) and an offline fake."""

import logging

from app.core.config import Settings
from app.transcription.base import (
    FILLER_WORDS,
    Transcript,
    TranscriptionError,
    TranscriptionProvider,
    TranscriptWord,
    is_filler,
    normalize_token,
)
from app.transcription.deepgram import DeepgramProvider, parse_deepgram_response
from app.transcription.fake import FakeProvider

logger = logging.getLogger(__name__)


def build_provider(settings: Settings) -> TranscriptionProvider:
    """deepgram | fake by TRANSCRIPTION_PROVIDER; `auto` = Deepgram when a key is set."""
    choice = settings.transcription_provider
    key = settings.deepgram_api_key.get_secret_value() if settings.deepgram_api_key else ""
    if choice == "auto":
        choice = "deepgram" if key else "fake"
        if choice == "fake":
            logger.warning("No DEEPGRAM_API_KEY: using the fake transcription provider")
    if choice == "deepgram":
        return DeepgramProvider(
            key,
            model=settings.deepgram_model,
            base_url=settings.deepgram_base_url,
            timeout_s=settings.deepgram_timeout_seconds,
        )
    return FakeProvider()


__all__ = [
    "FILLER_WORDS",
    "DeepgramProvider",
    "FakeProvider",
    "Transcript",
    "TranscriptWord",
    "TranscriptionError",
    "TranscriptionProvider",
    "build_provider",
    "is_filler",
    "normalize_token",
    "parse_deepgram_response",
]
