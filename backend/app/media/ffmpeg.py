"""Thin async wrappers around the `ffmpeg` / `ffprobe` command-line tools.

Every function runs the binary with `asyncio.create_subprocess_exec` (an argument list, never a
shell), raises `MediaError` with the tail of ffmpeg's stderr when it fails, and
`MediaToolMissingError` when the binary cannot be found.
"""

import asyncio
import contextlib
import json
import math
import re
import shutil
from array import array
from dataclasses import asdict, dataclass
from pathlib import Path
from typing import Any

import anyio

PROXY_SHORT_SIDE = 720


class MediaError(Exception):
    """ffmpeg/ffprobe failed or the file is not usable media."""


class MediaToolMissingError(MediaError):
    """The ffmpeg or ffprobe binary is not installed / not at the configured path."""


@dataclass(frozen=True, slots=True)
class MediaTools:
    """Where to find the binaries (settings FFMPEG_PATH / FFPROBE_PATH)."""

    ffmpeg: str = "ffmpeg"
    ffprobe: str = "ffprobe"

    def available(self) -> bool:
        return bool(shutil.which(self.ffmpeg) and shutil.which(self.ffprobe))


DEFAULT_TOOLS = MediaTools()


@dataclass(frozen=True, slots=True)
class ProbeResult:
    duration_ms: int
    width: int  # coded size of the video stream
    height: int
    fps: float | None
    video_codec: str
    audio_codec: str | None
    rotation: int  # degrees, normalized to 0/90/180/270
    pix_fmt: str | None = None
    audio_sample_rate: int | None = None
    audio_channels: int | None = None
    format_name: str | None = None

    @property
    def display_width(self) -> int:
        return self.height if self.rotation in (90, 270) else self.width

    @property
    def display_height(self) -> int:
        return self.width if self.rotation in (90, 270) else self.height

    @property
    def has_audio(self) -> bool:
        return self.audio_codec is not None

    def to_dict(self) -> dict[str, Any]:
        return asdict(self) | {
            "display_width": self.display_width,
            "display_height": self.display_height,
        }


# --- process helpers ---------------------------------------------------------------------


def _resolve(binary: str, setting: str) -> str:
    path = shutil.which(binary)
    if path is None:
        raise MediaToolMissingError(
            f"{binary!r} was not found. Install ffmpeg or set {setting} to the binary's path."
        )
    return path


def _tail(stderr: bytes, limit: int = 600) -> str:
    text = stderr.decode("utf-8", "replace").strip()
    return text[-limit:] if text else "no output"


async def _spawn(argv: list[str]) -> asyncio.subprocess.Process:
    try:
        return await asyncio.create_subprocess_exec(
            *argv,
            stdin=asyncio.subprocess.DEVNULL,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
        )
    except FileNotFoundError as exc:  # removed between which() and exec
        raise MediaToolMissingError(f"{argv[0]!r} could not be started") from exc


async def _kill(proc: asyncio.subprocess.Process) -> None:
    if proc.returncode is None:
        with contextlib.suppress(ProcessLookupError):
            proc.kill()
        with contextlib.suppress(Exception):
            await proc.wait()


async def _run(argv: list[str], *, what: str, time_limit: float | None) -> tuple[bytes, bytes]:
    proc = await _spawn(argv)
    try:
        async with asyncio.timeout(time_limit):
            stdout, stderr = await proc.communicate()
    except TimeoutError as exc:
        raise MediaError(f"{what} timed out after {time_limit:g}s") from exc
    finally:
        await _kill(proc)
    if proc.returncode != 0:
        raise MediaError(f"{what} failed: {_tail(stderr)}")
    return stdout, stderr


def _ffmpeg(tools: MediaTools) -> list[str]:
    exe = _resolve(tools.ffmpeg, "FFMPEG_PATH")
    return [exe, "-hide_banner", "-nostdin", "-y", "-loglevel", "error"]


# --- probe -------------------------------------------------------------------------------


def _fraction(value: str | None) -> float | None:
    if not value or value in ("0/0", "0"):
        return None
    num, _, den = value.partition("/")
    try:
        result = float(num) / float(den or 1)
    except ValueError, ZeroDivisionError:
        return None
    return round(result, 3) if result > 0 else None


def _rotation(stream: dict[str, Any]) -> int:
    raw: Any = None
    for side in stream.get("side_data_list") or []:
        if "rotation" in side:
            raw = side["rotation"]
            break
    if raw is None:
        raw = (stream.get("tags") or {}).get("rotate")
    try:
        degrees = round(float(raw or 0))
    except TypeError, ValueError:
        return 0
    return (round(degrees / 90) * 90) % 360


async def probe(
    path: Path, *, tools: MediaTools = DEFAULT_TOOLS, time_limit: float | None = 120
) -> ProbeResult:
    exe = _resolve(tools.ffprobe, "FFPROBE_PATH")
    argv = [
        exe, "-v", "error", "-print_format", "json", "-show_format", "-show_streams", str(path),
    ]  # fmt: skip
    stdout, _ = await _run(argv, what="ffprobe", time_limit=time_limit)
    try:
        info = json.loads(stdout or b"{}")
    except json.JSONDecodeError as exc:
        raise MediaError("ffprobe returned invalid JSON") from exc

    streams: list[dict[str, Any]] = info.get("streams") or []
    video = next(
        (
            s
            for s in streams
            if s.get("codec_type") == "video"
            and not (s.get("disposition") or {}).get("attached_pic")
        ),
        None,
    )
    if video is None or not video.get("width") or not video.get("height"):
        raise MediaError("File has no video stream")
    audio = next((s for s in streams if s.get("codec_type") == "audio"), None)

    fmt = info.get("format") or {}
    duration = fmt.get("duration") or video.get("duration")
    try:
        duration_ms = round(float(duration) * 1000)
    except TypeError, ValueError:
        raise MediaError("Could not read the video duration") from None
    if duration_ms <= 0:
        raise MediaError("Video has zero duration")

    return ProbeResult(
        duration_ms=duration_ms,
        width=int(video["width"]),
        height=int(video["height"]),
        fps=_fraction(video.get("avg_frame_rate")) or _fraction(video.get("r_frame_rate")),
        video_codec=str(video.get("codec_name") or "unknown"),
        audio_codec=str(audio.get("codec_name")) if audio else None,
        rotation=_rotation(video),
        pix_fmt=video.get("pix_fmt"),
        audio_sample_rate=int(audio["sample_rate"]) if audio and audio.get("sample_rate") else None,
        audio_channels=int(audio["channels"]) if audio and audio.get("channels") else None,
        format_name=fmt.get("format_name"),
    )


# --- proxy -------------------------------------------------------------------------------


def _even(value: float) -> int:
    return max(2, round(value / 2) * 2)


def proxy_size(display_width: int, display_height: int, short_side: int = PROXY_SHORT_SIDE):
    """Target (width, height): short side at most `short_side` (never upscaled), aspect kept,
    both even (H.264 + yuv420p need even dimensions)."""
    short = min(display_width, display_height)
    scale = min(1.0, short_side / short)
    return _even(display_width * scale), _even(display_height * scale)


async def make_proxy(
    src: Path,
    dst: Path,
    *,
    info: ProbeResult | None = None,
    crf: int = 23,
    tools: MediaTools = DEFAULT_TOOLS,
    time_limit: float | None = None,
) -> ProbeResult:
    """720p H.264 (yuv420p) + AAC MP4 with `+faststart`, playable in every browser.

    ffmpeg auto-rotates (applies the display matrix to the pixels and drops it), so phone
    videos come out upright; HEVC/.mov inputs are decoded like any other. Returns the probe of
    the output.
    """
    info = info or await probe(src, tools=tools)
    width, height = proxy_size(info.display_width, info.display_height)
    argv = [
        *_ffmpeg(tools), "-i", str(src),
        "-map", "0:v:0", "-map", "0:a:0?", "-sn", "-dn", "-map_metadata", "-1",
        "-vf", f"scale={width}:{height}:flags=bicubic,setsar=1,format=yuv420p",
        "-c:v", "libx264", "-preset", "veryfast", "-crf", str(crf),
        "-profile:v", "high", "-pix_fmt", "yuv420p",
        "-c:a", "aac", "-b:a", "128k", "-ac", "2",
        "-movflags", "+faststart", str(dst),
    ]  # fmt: skip
    await _run(argv, what="ffmpeg proxy", time_limit=time_limit)
    return await probe(dst, tools=tools)


# --- audio -------------------------------------------------------------------------------


async def extract_audio(
    src: Path,
    dst: Path,
    *,
    sample_rate: int = 16_000,
    tools: MediaTools = DEFAULT_TOOLS,
    time_limit: float | None = None,
) -> None:
    """Mono 16-bit PCM WAV at `sample_rate` (16 kHz is what speech-to-text models want)."""
    argv = [
        *_ffmpeg(tools), "-i", str(src), "-map", "0:a:0", "-vn",
        "-ac", "1", "-ar", str(sample_rate), "-c:a", "pcm_s16le", str(dst),
    ]  # fmt: skip
    await _run(argv, what="ffmpeg audio", time_limit=time_limit)


# --- thumbnails --------------------------------------------------------------------------


async def thumbnail_sprite(
    src: Path,
    dst: Path,
    every_s: float = 1.0,
    tile: int = 10,
    *,
    thumb_width: int = 160,
    max_frames: int = 100,
    info: ProbeResult | None = None,
    tools: MediaTools = DEFAULT_TOOLS,
    time_limit: float | None = None,
) -> dict[str, Any]:
    """One JPEG sprite sheet (`tile` thumbnails per row) and its index.

    Long videos get a larger interval so the sheet holds at most `max_frames` thumbnails.
    Index: {interval_s, width, height, columns, rows, count, frames: [{t, x, y}]}, where `t` is
    the time (seconds) a thumbnail shows and (x, y) its top-left pixel in the sheet.
    """
    if every_s <= 0 or tile < 1:
        raise ValueError("every_s must be > 0 and tile >= 1")
    info = info or await probe(src, tools=tools)
    duration_s = info.duration_ms / 1000
    interval = max(every_s, duration_s / max_frames)
    count = max(1, min(max_frames, math.ceil(duration_s / interval - 1e-9)))
    columns = min(tile, count)
    rows = math.ceil(count / columns)
    width = _even(thumb_width)
    height = _even(thumb_width * info.display_height / info.display_width)

    # fps=1/interval picks one frame per interval starting at t=0; tile packs them row-wise.
    vf = f"fps=1/{interval:.6f}:round=down,scale={width}:{height},setsar=1,tile={columns}x{rows}"
    argv = [
        *_ffmpeg(tools), "-i", str(src), "-an", "-sn", "-vf", vf,
        "-frames:v", "1", "-q:v", "4", str(dst),
    ]  # fmt: skip
    await _run(argv, what="ffmpeg thumbnails", time_limit=time_limit)
    if not await anyio.Path(dst).is_file():
        raise MediaError("ffmpeg did not write the sprite sheet")

    frames = [
        {
            "t": round(i * interval, 3),
            "x": (i % columns) * width,
            "y": (i // columns) * height,
        }
        for i in range(count)
    ]
    return {
        "interval_s": round(interval, 6),
        "width": width,
        "height": height,
        "columns": columns,
        "rows": rows,
        "count": count,
        "frames": frames,
    }


# --- waveform ----------------------------------------------------------------------------


async def waveform_peaks(
    src: Path,
    peaks_per_second: int = 50,
    *,
    sample_rate: int = 8_000,
    tools: MediaTools = DEFAULT_TOOLS,
    time_limit: float | None = None,
) -> list[float]:
    """Peak amplitude per 1/`peaks_per_second` s bucket, scaled so the loudest bucket is 1.0.

    ffmpeg decodes to mono s16le on a pipe; buckets are reduced in Python as the bytes arrive,
    so memory stays flat for long files. Silence gives all zeros.
    """
    if peaks_per_second <= 0 or sample_rate % peaks_per_second:
        raise ValueError("peaks_per_second must divide the sample rate")
    bucket = sample_rate // peaks_per_second
    bucket_bytes = bucket * 2
    argv = [
        *_ffmpeg(tools), "-i", str(src), "-map", "0:a:0", "-vn",
        "-ac", "1", "-ar", str(sample_rate), "-f", "s16le", "-acodec", "pcm_s16le", "-",
    ]  # fmt: skip
    proc = await _spawn(argv)
    assert proc.stdout is not None and proc.stderr is not None
    peaks: list[int] = []

    def reduce(chunk: bytes) -> None:
        samples = array("h")
        samples.frombytes(chunk)
        for start in range(0, len(samples), bucket):
            part = samples[start : start + bucket]
            peaks.append(max(max(part), -min(part)))

    async def read_stdout() -> None:
        assert proc.stdout is not None
        pending = b""
        while data := await proc.stdout.read(1 << 16):
            pending += data
            usable = len(pending) - len(pending) % bucket_bytes
            if usable:
                reduce(pending[:usable])
                pending = pending[usable:]
        pending = pending[: len(pending) - len(pending) % 2]
        if pending:
            reduce(pending)

    try:
        async with asyncio.timeout(time_limit):
            _, stderr = await asyncio.gather(read_stdout(), proc.stderr.read())
            await proc.wait()
    except TimeoutError as exc:
        raise MediaError(f"ffmpeg waveform timed out after {time_limit:g}s") from exc
    finally:
        await _kill(proc)
    if proc.returncode != 0:
        raise MediaError(f"ffmpeg waveform failed: {_tail(stderr)}")

    loudest = max(peaks, default=0)
    if loudest <= 0:
        return [0.0] * len(peaks)
    return [round(min(p, loudest) / loudest, 4) for p in peaks]


# --- loudness ----------------------------------------------------------------------------

_JSON_BLOCK = re.compile(rb"\{[^{}]*\}", re.DOTALL)


async def loudness(
    src: Path, *, tools: MediaTools = DEFAULT_TOOLS, time_limit: float | None = None
) -> float:
    """Integrated loudness (LUFS, EBU R128) from a `loudnorm` analysis pass.

    Returns `-inf` for digital silence.
    """
    exe = _resolve(tools.ffmpeg, "FFMPEG_PATH")
    argv = [
        exe, "-hide_banner", "-nostdin", "-nostats", "-i", str(src), "-map", "0:a:0", "-vn",
        "-af", "loudnorm=print_format=json", "-f", "null", "-",
    ]  # fmt: skip
    _, stderr = await _run(argv, what="ffmpeg loudness", time_limit=time_limit)
    blocks = _JSON_BLOCK.findall(stderr)
    if not blocks:
        raise MediaError("loudnorm printed no measurements")
    try:
        data = json.loads(blocks[-1])
        return float(data["input_i"])
    except (KeyError, TypeError, ValueError) as exc:
        raise MediaError("Could not parse loudnorm output") from exc
