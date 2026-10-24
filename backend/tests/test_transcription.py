"""A1: Deepgram response mapping (recorded fixture), filler marking, providers (no network)."""

import json
import wave
from pathlib import Path
from typing import Any

import httpx
import pytest

from app.transcription import (
    DeepgramProvider,
    FakeProvider,
    Transcript,
    TranscriptionError,
    TranscriptWord,
    build_provider,
    is_filler,
    parse_deepgram_response,
)
from app.transcription.base import seconds_to_ms
from app.transcription.fake import scripted_words
from tests.conftest import make_settings

pytestmark = pytest.mark.unit

FIXTURES = Path(__file__).with_name("fixtures")


def _fixture(name: str) -> dict[str, Any]:
    return json.loads((FIXTURES / name).read_text(encoding="utf-8"))


def _wav(path: Path, seconds: float, rate: int = 16_000) -> Path:
    with wave.open(str(path), "wb") as wav:
        wav.setnchannels(1)
        wav.setsampwidth(2)
        wav.setframerate(rate)
        wav.writeframes(b"\x00\x00" * int(rate * seconds))
    return path


# --- mapper ------------------------------------------------------------------------------


def test_deepgram_mapper_words_timings_and_fillers() -> None:
    t = parse_deepgram_response(_fixture("deepgram_nova3_response.json"), language="en")
    assert t.provider == "deepgram"
    assert t.language == "en"
    assert t.duration_ms == 6400
    assert len(t.words) == 21
    first, um = t.words[0], t.words[1]
    assert (first.text, first.start_ms, first.end_ms, first.filler) == ("So", 320, 520, False)
    # punctuated_word is what we show; the bare `word` decides the filler flag.
    assert (um.text, um.filler) == ("Um,", True)
    assert um.end_ms == 800  # 0.79999995 s rounds to 800 ms
    assert t.words[2].start_ms == 1281  # 1.2806 s
    assert t.words[3].start_ms == 1420  # 1.4204999 s
    assert [w.text for w in t.words if w.filler] == ["Um,", "uh,"]
    # smart_format output is kept as Deepgram wrote it ("3"), punctuation included.
    assert t.words[19].text == "3"
    assert t.words[-1].text == "seconds."
    assert t.words[7].text == "getting..."
    assert all(w.end_ms >= w.start_ms for w in t.words)
    assert t.words[0].confidence == pytest.approx(0.9932, abs=1e-4)


def test_deepgram_mapper_empty_audio() -> None:
    t = parse_deepgram_response(_fixture("deepgram_empty_response.json"), language="en")
    assert t.words == []
    assert t.duration_ms == 2000
    assert t.language == "en"


def test_deepgram_mapper_tolerates_missing_parts() -> None:
    t = parse_deepgram_response({}, language=None)
    assert (t.words, t.duration_ms, t.language) == ([], 0, None)
    detected = parse_deepgram_response(
        {"results": {"channels": [{"detected_language": "es", "alternatives": []}]}},
        language="en",
    )
    assert detected.language == "es"


def test_transcript_round_trips_through_json() -> None:
    t = parse_deepgram_response(_fixture("deepgram_nova3_response.json"), model="nova-3")
    again = Transcript.from_dict(json.loads(json.dumps(t.to_dict())))
    assert again.words == t.words
    assert again.model == "nova-3"


@pytest.mark.parametrize(
    ("text", "expected"),
    [
        ("um", True),
        ("Um,", True),
        ("UH.", True),
        ("erm", True),
        ("hmm", True),
        ("mm", True),
        ("ah", True),
        ("mhmm", True),
        ("uh-huh", True),
        ("like", False),  # "like" as a filler cannot be told apart from normal use
        ("umbrella", False),
        ("so", False),
        ("", False),
    ],
)
def test_filler_mapping(text: str, expected: bool) -> None:
    assert is_filler(text) is expected


def test_seconds_to_ms_rounds_half_up() -> None:
    assert seconds_to_ms(0.0005) == 1
    assert seconds_to_ms(1.9994) == 1999
    assert seconds_to_ms(-0.2) == 0


# --- Deepgram provider over a mocked transport ----------------------------------------------


async def test_deepgram_provider_request(tmp_path: Path) -> None:
    seen: dict[str, Any] = {}

    def handler(request: httpx.Request) -> httpx.Response:
        seen["url"] = request.url
        seen["headers"] = request.headers
        seen["body"] = request.read()
        return httpx.Response(200, json=_fixture("deepgram_nova3_response.json"))

    audio = _wav(tmp_path / "a.wav", 0.1)
    provider = DeepgramProvider(
        "dg-test-key", model="nova-3", transport=httpx.MockTransport(handler)
    )
    t = await provider.transcribe(audio, "en")
    assert len(t.words) == 21
    assert t.model == "nova-3"
    url: httpx.URL = seen["url"]
    assert (url.scheme, url.host, url.path) == ("https", "api.deepgram.com", "/v1/listen")
    assert dict(url.params) == {
        "model": "nova-3",
        "punctuate": "true",
        "smart_format": "true",
        "filler_words": "true",
        "language": "en",
    }
    assert seen["headers"]["authorization"] == "Token dg-test-key"
    assert seen["headers"]["content-type"] == "audio/wav"
    assert seen["body"] == audio.read_bytes()


async def test_deepgram_provider_errors_hide_the_key(tmp_path: Path) -> None:
    audio = _wav(tmp_path / "a.wav", 0.1)

    def unauthorized(request: httpx.Request) -> httpx.Response:
        return httpx.Response(401, json={"err_code": "INVALID_AUTH", "err_msg": "Invalid creds"})

    provider = DeepgramProvider("dg-secret", transport=httpx.MockTransport(unauthorized))
    with pytest.raises(TranscriptionError) as info:
        await provider.transcribe(audio, "en")
    assert "401" in str(info.value) and "dg-secret" not in str(info.value)

    def broken(request: httpx.Request) -> httpx.Response:
        raise httpx.ConnectError("boom")

    provider = DeepgramProvider("dg-secret", transport=httpx.MockTransport(broken))
    with pytest.raises(TranscriptionError, match="Could not reach Deepgram"):
        await provider.transcribe(audio, "en")


def test_deepgram_provider_needs_a_key() -> None:
    with pytest.raises(TranscriptionError, match="DEEPGRAM_API_KEY"):
        DeepgramProvider("")


# --- fake provider + selection -------------------------------------------------------------


async def test_fake_provider_is_deterministic_and_fits_the_audio(tmp_path: Path) -> None:
    audio = _wav(tmp_path / "a.wav", 6.0)
    one = await FakeProvider().transcribe(audio, "en")
    two = await FakeProvider().transcribe(audio, "en")
    assert one.words == two.words
    assert one.duration_ms == 6000
    assert one.words and one.words[-1].end_ms <= 6000
    assert one.words[1].filler and one.words[1].text == "um,"
    assert scripted_words(200) == []
    assert len(scripted_words(60_000)) > len(scripted_words(20_000))  # the script repeats


async def test_fake_provider_returns_a_supplied_transcript(tmp_path: Path) -> None:
    given = Transcript(words=[TranscriptWord("hi", 0, 100)], language="en", duration_ms=500)
    assert await FakeProvider(given).transcribe(tmp_path / "missing.wav", None) is given


async def test_fake_provider_rejects_non_wav(tmp_path: Path) -> None:
    bad = tmp_path / "x.wav"
    bad.write_bytes(b"not a wav")
    with pytest.raises(TranscriptionError):
        await FakeProvider().transcribe(bad, None)


def test_provider_selection(tmp_path: Path) -> None:
    def pick(**overrides: Any) -> str:
        return build_provider(make_settings(tmp_path, **overrides)).name

    assert pick(transcription_provider="auto", deepgram_api_key=None) == "fake"
    assert pick(transcription_provider="auto", deepgram_api_key="k") == "deepgram"
    assert pick(transcription_provider="fake", deepgram_api_key="k") == "fake"
    assert pick(transcription_provider="deepgram", deepgram_api_key="k") == "deepgram"
    with pytest.raises(TranscriptionError):
        pick(transcription_provider="deepgram", deepgram_api_key=None)
    assert make_settings(tmp_path).deepgram_model == "nova-3"
