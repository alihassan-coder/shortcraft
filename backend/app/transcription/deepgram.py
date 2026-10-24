"""Deepgram pre-recorded speech-to-text over its REST API (httpx, no SDK).

Docs (checked 2026-10-24):
- https://developers.deepgram.com/reference/speech-to-text/listen-pre-recorded
  POST https://api.deepgram.com/v1/listen, header `Authorization: Token <key>`; query params
  `model`, `language` (BCP-47, default en), `punctuate`, `smart_format`, `filler_words`.
  Response: metadata.duration (s), results.channels[].alternatives[].words[] with
  word, start, end, confidence, punctuated_word; channels[].detected_language.
- https://developers.deepgram.com/docs/filler-words
  `filler_words=true` keeps uh/um (removed by default); raw audio is sent as the request body
  with its Content-Type (e.g. audio/wav).
- https://developers.deepgram.com/docs/models-languages-overview
  nova-3 is the current general-purpose Nova model.
"""

from collections.abc import AsyncIterator
from pathlib import Path
from typing import Any

import anyio
import httpx

from app.transcription.base import (
    Transcript,
    TranscriptionError,
    TranscriptWord,
    is_filler,
    seconds_to_ms,
)

CHUNK = 1 << 16


def parse_deepgram_response(
    data: dict[str, Any], *, language: str | None = None, model: str | None = None
) -> Transcript:
    """Map Deepgram's JSON to a Transcript (first channel, best alternative)."""
    metadata = data.get("metadata") or {}
    duration_ms = seconds_to_ms(metadata.get("duration") or 0)
    channels = (data.get("results") or {}).get("channels") or []
    channel = channels[0] if channels else {}
    alternatives = channel.get("alternatives") or []
    raw_words = (alternatives[0].get("words") if alternatives else None) or []

    words: list[TranscriptWord] = []
    for raw in raw_words:
        token = str(raw.get("word") or "").strip()
        text = str(raw.get("punctuated_word") or token).strip()
        if not text:
            continue
        start = seconds_to_ms(raw.get("start") or 0)
        end = max(start, seconds_to_ms(raw.get("end") or 0))
        confidence = raw.get("confidence")
        words.append(
            TranscriptWord(
                text=text,
                start_ms=start,
                end_ms=end,
                confidence=round(float(confidence), 4) if confidence is not None else None,
                filler=is_filler(token or text),
            )
        )
    words.sort(key=lambda w: (w.start_ms, w.end_ms))
    if words:
        duration_ms = max(duration_ms, words[-1].end_ms)
    detected = channel.get("detected_language")
    return Transcript(
        words=words,
        language=detected or language,
        duration_ms=duration_ms,
        provider="deepgram",
        model=model,
        extra={"request_id": metadata.get("request_id")},
    )


class DeepgramProvider:
    name = "deepgram"

    def __init__(
        self,
        api_key: str,
        *,
        model: str = "nova-3",
        base_url: str = "https://api.deepgram.com",
        timeout_s: float = 300,
        transport: httpx.AsyncBaseTransport | None = None,
    ) -> None:
        if not api_key:
            raise TranscriptionError("DEEPGRAM_API_KEY is not set")
        self._api_key = api_key
        self.model = model
        self.base_url = base_url.rstrip("/")
        self.timeout_s = timeout_s
        self._transport = transport

    def params(self, language: str | None) -> dict[str, str]:
        params = {
            "model": self.model,
            "punctuate": "true",
            "smart_format": "true",
            "filler_words": "true",
        }
        if language:
            params["language"] = language
        return params

    async def transcribe(self, audio_path: Path, language: str | None) -> Transcript:
        async def body() -> AsyncIterator[bytes]:
            async with await anyio.open_file(audio_path, "rb") as fh:
                while chunk := await fh.read(CHUNK):
                    yield chunk

        headers = {"Authorization": f"Token {self._api_key}", "Content-Type": "audio/wav"}
        timeout = httpx.Timeout(self.timeout_s, connect=15)
        try:
            async with httpx.AsyncClient(timeout=timeout, transport=self._transport) as client:
                response = await client.post(
                    f"{self.base_url}/v1/listen",
                    params=self.params(language),
                    headers=headers,
                    content=body(),
                )
        except httpx.TimeoutException as exc:
            raise TranscriptionError("Deepgram timed out") from exc
        except httpx.HTTPError as exc:
            raise TranscriptionError(f"Could not reach Deepgram ({type(exc).__name__})") from exc

        if response.status_code >= 400:
            raise TranscriptionError(_error_message(response))
        try:
            data = response.json()
        except ValueError as exc:
            raise TranscriptionError("Deepgram returned invalid JSON") from exc
        return parse_deepgram_response(data, language=language, model=self.model)


def _error_message(response: httpx.Response) -> str:
    detail = ""
    try:
        data = response.json()
        if isinstance(data, dict):
            detail = str(data.get("err_msg") or data.get("message") or data.get("reason") or "")
    except ValueError:
        pass
    if response.status_code in (401, 403):
        detail = detail or "check DEEPGRAM_API_KEY"
    return f"Deepgram returned {response.status_code}" + (f": {detail[:300]}" if detail else "")
