"""The `transcribe` job: 16 kHz WAV (from the proxy job) -> timed words -> transcript.json.

Needs a source whose proxy job made `audio-16k.wav`. Stores the transcript next to the other
artifacts, fills `Source.transcript_*`, then (AUTO_PLAN) starts a basic `plan` job.
"""

import json
import tempfile
from pathlib import Path
from typing import Any

import anyio

from app.db.models import Job, Source
from app.services.storage import SOURCE_ARTIFACTS, source_artifact_key
from app.transcription import TranscriptionError
from app.worker.chain import enqueue_followup
from app.worker.context import JobContext, JobFailedError, Progress

TRANSCRIPT_FILE = "transcript.json"


async def run_transcribe(ctx: JobContext, job: Job, progress: Progress) -> dict[str, Any]:
    if job.source_id is None:
        raise JobFailedError("A transcribe job needs a source_id")
    params = job.params or {}
    async with ctx.sessionmaker() as session:
        source = await session.get(Source, job.source_id)
        if source is None or source.project_id != job.project_id:
            raise JobFailedError("Source not found")
        if source.audio_key is None:
            if source.status == "ready":
                raise JobFailedError("This video has no audio track to transcribe")
            raise JobFailedError("Source audio is not ready yet (the proxy job makes it)")
        project_id, source_id, audio_key = source.project_id, source.id, source.audio_key

    language = str(params.get("language") or ctx.settings.transcription_language or "") or None
    provider = ctx.transcription_provider()
    work_dir = ctx.settings.work_dir
    if work_dir is not None:
        await anyio.Path(work_dir).mkdir(parents=True, exist_ok=True)

    with tempfile.TemporaryDirectory(
        prefix="shortcraft-transcribe-", dir=work_dir, ignore_cleanup_errors=True
    ) as tmp_name:
        tmp = Path(tmp_name)
        audio = tmp / "audio-16k.wav"
        await ctx.storage.download_to(audio_key, audio)
        await progress(10)

        try:
            transcript = await provider.transcribe(audio, language)
        except TranscriptionError as exc:
            raise JobFailedError(f"Transcription failed: {exc}") from exc
        await progress(80)

        out = tmp / TRANSCRIPT_FILE
        await anyio.Path(out).write_text(
            json.dumps(transcript.to_dict(), ensure_ascii=False, separators=(",", ":")),
            encoding="utf-8",
        )
        key = source_artifact_key(project_id, source_id, TRANSCRIPT_FILE)
        await ctx.storage.upload_from(out, key, SOURCE_ARTIFACTS[TRANSCRIPT_FILE])
        await progress(95)

    async with ctx.sessionmaker() as session:
        row = await session.get(Source, source_id)
        if row is not None:
            row.transcript_key = key
            row.transcript_language = (transcript.language or "")[:20] or None
            row.transcript_word_count = len(transcript.words)
            await session.commit()

    plan_job = None
    if ctx.settings.auto_plan:
        plan_params = {"mode": "basic", "vibe": params.get("vibe") or "energetic"}
        plan_job = await enqueue_followup(ctx, project_id, source_id, "plan", plan_params)

    return {
        "source_id": str(source_id),
        "provider": transcript.provider,
        "model": transcript.model,
        "language": transcript.language,
        "duration_ms": transcript.duration_ms,
        "word_count": len(transcript.words),
        "filler_count": sum(1 for w in transcript.words if w.filler),
        "transcript_key": key,
        "plan_job_id": str(plan_job) if plan_job else None,
    }
