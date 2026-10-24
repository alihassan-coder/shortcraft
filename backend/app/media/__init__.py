"""Media processing with the ffmpeg/ffprobe CLI (pure async functions, no app state)."""

from app.media.ffmpeg import (
    DEFAULT_TOOLS,
    MediaError,
    MediaToolMissingError,
    MediaTools,
    ProbeResult,
    detect_silences,
    extract_audio,
    loudness,
    make_proxy,
    parse_silences,
    probe,
    proxy_size,
    thumbnail_sprite,
    waveform_peaks,
)

__all__ = [
    "DEFAULT_TOOLS",
    "MediaError",
    "MediaToolMissingError",
    "MediaTools",
    "ProbeResult",
    "detect_silences",
    "extract_audio",
    "loudness",
    "make_proxy",
    "parse_silences",
    "probe",
    "proxy_size",
    "thumbnail_sprite",
    "waveform_peaks",
]
