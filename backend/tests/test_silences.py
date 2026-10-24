"""ffmpeg silencedetect: log parsing (unit) and a real run on a clip with a 1 s gap."""

from pathlib import Path

import pytest

from app.media import detect_silences, extract_audio, parse_silences


@pytest.mark.unit
def test_parse_silences() -> None:
    log = (
        b"[silencedetect @ 0x1] silence_start: 0\n"
        b"[silencedetect @ 0x1] silence_end: 0.412 | silence_duration: 0.412\n"
        b"size=N/A time=00:00:05.00\n"
        b"[silencedetect @ 0x1] silence_start: 2.0004\n"
        b"[silencedetect @ 0x1] silence_end: 3.01 | silence_duration: 1.0095\n"
        b"[silencedetect @ 0x1] silence_start: 5.5\n"
    )
    assert parse_silences(log, 6000) == [(0, 412), (2000, 3010), (5500, 6000)]
    assert parse_silences(log) == [(0, 412), (2000, 3010)]  # open silence, unknown end
    assert parse_silences(b"nothing here") == []


@pytest.mark.unit
@pytest.mark.ffmpeg
async def test_detect_silences_finds_the_gap(gap_clip: Path, tmp_path: Path) -> None:
    wav = tmp_path / "audio.wav"
    await extract_audio(gap_clip, wav)
    silences = await detect_silences(wav, noise_db=-35, min_silence_s=0.35, duration_ms=6000)
    assert len(silences) == 1, silences
    start, end = silences[0]
    assert abs(start - 2000) <= 80
    assert abs(end - 3000) <= 80
    # Nothing silent when the minimum length is longer than the gap.
    assert await detect_silences(wav, min_silence_s=1.5, duration_ms=6000) == []
