"""The `proxy` job: make everything the editor needs from an uploaded original.

original (storage) -> temp dir -> probe -> 720p H.264 proxy -> 16 kHz mono WAV -> thumbnail
sprite + index -> waveform peaks (+ loudness) -> upload artifacts -> update the Source row.
"""

import json
import math
import tempfile
import uuid
from pathlib import Path
from typing import Any

import anyio

from app.db.models import Job, Source
from app.media import (
    extract_audio,
    loudness,
    make_proxy,
    probe,
    thumbnail_sprite,
    waveform_peaks,
)
from app.services.storage import SOURCE_ARTIFACTS, source_artifact_key
from app.worker.context import JobContext, JobFailedError, Progress

PEAKS_PER_SECOND = 50
SPRITE_EVERY_S = 1.0
SPRITE_TILE = 10


async def _write_json(path: Path, data: Any) -> None:
    await anyio.Path(path).write_text(json.dumps(data, separators=(",", ":")), encoding="utf-8")


async def _set_source(ctx: JobContext, source_id: uuid.UUID, **values: Any) -> None:
    async with ctx.sessionmaker() as session:
        source = await session.get(Source, source_id)
        if source is not None:
            for name, value in values.items():
                setattr(source, name, value)
            await session.commit()


async def run_proxy(ctx: JobContext, job: Job, progress: Progress) -> dict[str, Any]:
    if job.source_id is None:
        raise JobFailedError("A proxy job needs a source_id")
    async with ctx.sessionmaker() as session:
        source = await session.get(Source, job.source_id)
        if source is None or source.project_id != job.project_id:
            raise JobFailedError("Source not found")
        if not source.has_file:
            raise JobFailedError("Source has not been uploaded yet")
        source.status = "processing"
        await session.commit()
        project_id, source_id = source.project_id, source.id
        original_key, suffix = source.storage_key, Path(source.storage_key).suffix

    try:
        result = await _process(ctx, project_id, source_id, original_key, suffix, progress)
    except BaseException:
        await _set_source(ctx, source_id, status="failed")
        raise
    return result


async def _process(
    ctx: JobContext,
    project_id: uuid.UUID,
    source_id: uuid.UUID,
    original_key: str,
    suffix: str,
    progress: Progress,
) -> dict[str, Any]:
    tools = ctx.tools
    limit = float(ctx.settings.job_timeout_seconds)
    work_dir = ctx.settings.work_dir
    if work_dir is not None:
        await anyio.Path(work_dir).mkdir(parents=True, exist_ok=True)

    with tempfile.TemporaryDirectory(
        prefix="shortcraft-proxy-", dir=work_dir, ignore_cleanup_errors=True
    ) as tmp_name:
        tmp = Path(tmp_name)
        original = tmp / f"original{suffix}"
        files = {name: tmp / name for name in SOURCE_ARTIFACTS}

        await ctx.storage.download_to(original_key, original)
        await progress(10)

        info = await probe(original, tools=tools)
        await progress(20)

        proxy_info = await make_proxy(
            original, files["proxy-720p.mp4"], info=info, tools=tools, time_limit=limit
        )
        await progress(60)

        sprite_index = await thumbnail_sprite(
            files["proxy-720p.mp4"],
            files["sprite.jpg"],
            SPRITE_EVERY_S,
            SPRITE_TILE,
            info=proxy_info,
            tools=tools,
            time_limit=limit,
        )
        await _write_json(files["sprite.json"], sprite_index)
        await progress(70)

        lufs: float | None = None
        made = ["proxy-720p.mp4", "sprite.jpg", "sprite.json"]
        if info.has_audio:
            await extract_audio(original, files["audio-16k.wav"], tools=tools, time_limit=limit)
            await progress(80)
            peaks = await waveform_peaks(
                files["audio-16k.wav"], PEAKS_PER_SECOND, tools=tools, time_limit=limit
            )
            await _write_json(
                files["peaks.json"],
                {
                    "peaks_per_second": PEAKS_PER_SECOND,
                    "duration_ms": info.duration_ms,
                    "count": len(peaks),
                    "peaks": peaks,
                },
            )
            measured = await loudness(files["audio-16k.wav"], tools=tools, time_limit=limit)
            lufs = round(measured, 2) if math.isfinite(measured) else None
            made += ["audio-16k.wav", "peaks.json"]
            await progress(88)

        keys: dict[str, str] = {}
        for name in made:
            key = source_artifact_key(project_id, source_id, name)
            await ctx.storage.upload_from(files[name], key, SOURCE_ARTIFACTS[name])
            keys[name] = key
        await progress(97)

    await _set_source(
        ctx,
        source_id,
        status="ready",
        width=info.display_width,
        height=info.display_height,
        duration_ms=info.duration_ms,
        fps=info.fps,
        video_codec=info.video_codec,
        audio_codec=info.audio_codec,
        proxy_key=keys["proxy-720p.mp4"],
        sprite_key=keys["sprite.jpg"],
        sprite_index_key=keys["sprite.json"],
        audio_key=keys.get("audio-16k.wav"),
        peaks_key=keys.get("peaks.json"),
    )
    return {
        "source_id": str(source_id),
        "probe": info.to_dict(),
        "proxy": {
            "width": proxy_info.width,
            "height": proxy_info.height,
            "duration_ms": proxy_info.duration_ms,
        },
        "loudness_lufs": lufs,
        "sprite": {k: v for k, v in sprite_index.items() if k != "frames"},
        "artifacts": keys,
    }
