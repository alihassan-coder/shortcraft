import math
from pathlib import Path

import pytest

from app.media import (
    MediaError,
    MediaToolMissingError,
    MediaTools,
    extract_audio,
    loudness,
    make_proxy,
    probe,
    proxy_size,
    thumbnail_sprite,
    waveform_peaks,
)

ffmpeg = pytest.mark.ffmpeg


# --- pure helpers (no ffmpeg) -----------------------------------------------------------------


@pytest.mark.parametrize(
    ("size", "expected"),
    [
        ((1080, 1920), (720, 1280)),  # portrait phone video
        ((1920, 1080), (1280, 720)),
        ((3840, 2160), (1280, 720)),
        ((320, 568), (320, 568)),  # never upscaled
        ((1081, 1921), (720, 1280)),  # odd input -> even output
        ((721, 1001), (720, 1000)),
    ],
)
def test_proxy_size(size: tuple[int, int], expected: tuple[int, int]) -> None:
    width, height = proxy_size(*size)
    assert (width, height) == expected
    assert width % 2 == 0 and height % 2 == 0


async def test_missing_binary_has_clear_error(tmp_path: Path) -> None:
    tools = MediaTools(ffmpeg="definitely-not-ffmpeg", ffprobe="definitely-not-ffprobe")
    with pytest.raises(MediaToolMissingError, match="FFPROBE_PATH"):
        await probe(tmp_path / "x.mp4", tools=tools)
    with pytest.raises(MediaToolMissingError, match="FFMPEG_PATH"):
        await extract_audio(tmp_path / "x.mp4", tmp_path / "x.wav", tools=tools)


# --- real ffmpeg on tiny clips ----------------------------------------------------------------


@ffmpeg
async def test_probe_h264_mp4(media_dir: Path) -> None:
    info = await probe(media_dir / "clip.mp4")
    assert abs(info.duration_ms - 3000) <= 100
    assert (info.width, info.height) == (320, 568)
    assert info.fps == 30
    assert info.video_codec == "h264"
    assert info.audio_codec == "aac"
    assert info.rotation == 0
    assert (info.display_width, info.display_height) == (320, 568)


@ffmpeg
async def test_probe_rotated_mov(media_dir: Path) -> None:
    info = await probe(media_dir / "rotated.mov")
    assert info.rotation in (90, 270)
    assert (info.display_width, info.display_height) == (568, 320)


@ffmpeg
async def test_probe_rejects_corrupt_file(media_dir: Path) -> None:
    with pytest.raises(MediaError, match="ffprobe failed"):
        await probe(media_dir / "corrupt.mp4")


@ffmpeg
async def test_proxy_keeps_small_video_and_is_browser_safe(media_dir: Path, tmp_path: Path) -> None:
    out = tmp_path / "proxy.mp4"
    info = await make_proxy(media_dir / "clip.mp4", out)
    assert out.is_file()
    assert (info.width, info.height) == (320, 568)
    assert info.video_codec == "h264"
    assert info.pix_fmt == "yuv420p"
    assert info.audio_codec == "aac"
    assert abs(info.duration_ms - 3000) <= 150
    # +faststart: the moov atom comes before mdat.
    head = out.read_bytes()[:4096]
    assert head.find(b"moov") != -1 and (
        head.find(b"mdat") == -1 or head.find(b"moov") < head.find(b"mdat")
    )


@ffmpeg
async def test_proxy_scales_down_to_720p(media_dir: Path, tmp_path: Path) -> None:
    info = await make_proxy(media_dir / "big.mp4", tmp_path / "proxy.mp4")
    assert (info.width, info.height) == (720, 1280)
    assert info.audio_codec is None


@ffmpeg
async def test_proxy_applies_rotation(media_dir: Path, tmp_path: Path) -> None:
    info = await make_proxy(media_dir / "rotated.mov", tmp_path / "proxy.mp4")
    assert (info.width, info.height) == (568, 320)
    assert info.rotation == 0


@ffmpeg
async def test_proxy_from_hevc_mov(media_dir: Path, tmp_path: Path) -> None:
    src = media_dir / "hevc.mov"
    if not src.exists():
        pytest.skip("this ffmpeg build has no libx265")
    assert (await probe(src)).video_codec == "hevc"
    info = await make_proxy(src, tmp_path / "proxy.mp4")
    assert info.video_codec == "h264"
    assert (info.width, info.height) == (320, 568)


@ffmpeg
async def test_extract_audio_is_16k_mono_wav(media_dir: Path, tmp_path: Path) -> None:
    out = tmp_path / "audio.wav"
    await extract_audio(media_dir / "clip.mp4", out)
    assert out.read_bytes()[:4] == b"RIFF"
    info = await _audio_probe(out)
    assert info == {"codec_name": "pcm_s16le", "sample_rate": "16000", "channels": 1}


@ffmpeg
async def test_extract_audio_without_audio_track_fails(media_dir: Path, tmp_path: Path) -> None:
    with pytest.raises(MediaError, match="ffmpeg audio failed"):
        await extract_audio(media_dir / "silent.mp4", tmp_path / "audio.wav")


@ffmpeg
async def test_thumbnail_sprite(media_dir: Path, tmp_path: Path) -> None:
    out = tmp_path / "sprite.jpg"
    index = await thumbnail_sprite(media_dir / "clip.mp4", out, every_s=1.0, tile=10)
    assert out.read_bytes()[:2] == b"\xff\xd8"  # JPEG
    assert index["count"] == 3
    assert len(index["frames"]) == 3
    assert (index["columns"], index["rows"]) == (3, 1)
    assert (index["width"], index["height"]) == (160, 284)
    assert [f["t"] for f in index["frames"]] == [0.0, 1.0, 2.0]
    assert [(f["x"], f["y"]) for f in index["frames"]] == [(0, 0), (160, 0), (320, 0)]
    sheet = await probe(out)
    assert (sheet.width, sheet.height) == (480, 284)


@ffmpeg
async def test_thumbnail_sprite_wraps_rows(media_dir: Path, tmp_path: Path) -> None:
    index = await thumbnail_sprite(media_dir / "clip.mp4", tmp_path / "s.jpg", every_s=0.5, tile=4)
    assert index["count"] == 6
    assert (index["columns"], index["rows"]) == (4, 2)
    assert index["frames"][4] == {"t": 2.0, "x": 0, "y": index["height"]}


@ffmpeg
async def test_waveform_peaks(media_dir: Path) -> None:
    peaks = await waveform_peaks(media_dir / "clip.mp4", peaks_per_second=50)
    assert abs(len(peaks) - 3 * 50) <= 5
    assert all(0.0 <= p <= 1.0 for p in peaks)
    assert max(peaks) == 1.0
    # A steady sine: most buckets are near the top.
    assert sorted(peaks)[len(peaks) // 2] > 0.8


@ffmpeg
async def test_loudness(media_dir: Path) -> None:
    lufs = await loudness(media_dir / "clip.mp4")
    assert isinstance(lufs, float)
    assert math.isfinite(lufs)
    assert -70 < lufs < 0


async def _audio_probe(path: Path) -> dict[str, object]:
    import asyncio
    import json

    proc = await asyncio.create_subprocess_exec(
        "ffprobe", "-v", "error", "-show_entries", "stream=codec_name,sample_rate,channels",
        "-of", "json", str(path),
        stdout=asyncio.subprocess.PIPE,
    )  # fmt: skip
    stdout, _ = await proc.communicate()
    return json.loads(stdout)["streams"][0]
