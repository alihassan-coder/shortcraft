"""Speech-to-text contract: a provider turns a WAV file into timed words (fillers kept)."""

import math
import re
from dataclasses import asdict, dataclass, field
from pathlib import Path
from typing import Any, Protocol

# Filler tokens. Deepgram (filler_words=true) always spells its fillers as
# uh, um, mhmm, mm-mm, uh-uh, uh-huh, nuh-uh; the rest is the classic hesitation set.
# "like" / "you know" used as fillers cannot be told apart from normal use, so never marked.
FILLER_WORDS = frozenset(
    {"um", "uh", "er", "erm", "hmm", "mm", "ah", "mhmm", "mm-mm", "uh-uh", "uh-huh", "nuh-uh"}
)

_EDGE_PUNCT = re.compile(r"^[^\w]+|[^\w]+$")


def normalize_token(text: str) -> str:
    """Lowercase, without leading/trailing punctuation ("Um," -> "um", "uh-huh." -> "uh-huh")."""
    return _EDGE_PUNCT.sub("", text.strip().lower().replace("’", "'"))


def is_filler(text: str) -> bool:
    return normalize_token(text) in FILLER_WORDS


def seconds_to_ms(value: float) -> int:
    """Seconds -> whole milliseconds, rounding half up (0.0005 s -> 1 ms)."""
    return max(0, math.floor(float(value) * 1000 + 0.5))


class TranscriptionError(Exception):
    """Speech-to-text failed for a reason worth showing to the user (no secrets inside)."""


@dataclass(frozen=True, slots=True)
class TranscriptWord:
    text: str  # as displayed (punctuated when the provider gives it)
    start_ms: int
    end_ms: int
    confidence: float | None = None
    filler: bool = False


@dataclass(frozen=True, slots=True)
class Transcript:
    words: list[TranscriptWord]
    language: str | None
    duration_ms: int
    provider: str = "unknown"
    model: str | None = None
    extra: dict[str, Any] = field(default_factory=dict)

    def to_dict(self) -> dict[str, Any]:
        return {
            "provider": self.provider,
            "model": self.model,
            "language": self.language,
            "duration_ms": self.duration_ms,
            "words": [asdict(w) for w in self.words],
        }

    @classmethod
    def from_dict(cls, data: dict[str, Any]) -> Transcript:
        words = [
            TranscriptWord(
                text=str(w["text"]),
                start_ms=int(w["start_ms"]),
                end_ms=int(w["end_ms"]),
                confidence=w.get("confidence"),
                filler=bool(w.get("filler", False)),
            )
            for w in data.get("words") or []
        ]
        return cls(
            words=words,
            language=data.get("language"),
            duration_ms=int(data.get("duration_ms") or 0),
            provider=str(data.get("provider") or "unknown"),
            model=data.get("model"),
        )


class TranscriptionProvider(Protocol):
    name: str

    async def transcribe(self, audio_path: Path, language: str | None) -> Transcript:
        """Words with start/end times in ms, fillers kept and flagged."""
        ...
