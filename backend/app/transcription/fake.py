"""Offline provider for tests and keyless dev: deterministic words, no network."""

import json
import wave
from functools import cache
from pathlib import Path
from typing import Any

import anyio.to_thread

from app.transcription.base import Transcript, TranscriptionError, TranscriptWord, is_filler

SCRIPT_PATH = Path(__file__).with_name("fixtures") / "fake_script.json"
END_MARGIN_MS = 100


@cache
def _script() -> dict[str, Any]:
    return json.loads(SCRIPT_PATH.read_text(encoding="utf-8"))


def scripted_words(duration_ms: int) -> list[TranscriptWord]:
    """The fixture script laid out from `start_ms`, repeated, cut off before the audio ends."""
    script = _script()
    tokens: list[list[Any]] = script["tokens"]
    limit = duration_ms - END_MARGIN_MS
    t = int(script["start_ms"])
    words: list[TranscriptWord] = []
    while tokens:
        for text, length, pause in tokens:
            if t + int(length) > limit:
                return words
            words.append(
                TranscriptWord(
                    text=str(text),
                    start_ms=t,
                    end_ms=t + int(length),
                    confidence=0.99,
                    filler=is_filler(str(text)),
                )
            )
            t += int(length) + int(pause)
    return words


def wav_duration_ms(path: Path) -> int:
    try:
        with wave.open(str(path), "rb") as wav:
            rate = wav.getframerate()
            return round(wav.getnframes() * 1000 / rate) if rate else 0
    except (wave.Error, EOFError, OSError) as exc:
        raise TranscriptionError("Audio is not a readable WAV file") from exc


class FakeProvider:
    name = "fake"

    def __init__(self, transcript: Transcript | None = None) -> None:
        self.transcript = transcript

    async def transcribe(self, audio_path: Path, language: str | None) -> Transcript:
        if self.transcript is not None:
            return self.transcript
        duration_ms = await anyio.to_thread.run_sync(wav_duration_ms, audio_path)
        return Transcript(
            words=scripted_words(duration_ms),
            language=language or _script().get("language"),
            duration_ms=duration_ms,
            provider=self.name,
            model="fake-script",
        )
