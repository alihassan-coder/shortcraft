"""The `plan` job: the first edit.

mode "basic": transcript.json + ffmpeg silencedetect on audio-16k.wav -> `build_basic_plan`
-> validated EditPlan v2 -> saved as the project's next plan revision.

mode "ai": the same basic plan, then the LangGraph agents (app/ai/graph.py) propose edit
commands, which are validated and applied in Python before saving. Without an OpenAI key,
or when the agents fail, the basic plan is saved and the job result carries a warning: AI
problems never fail the upload.
"""

import asyncio
import json
import logging
import tempfile
import uuid
from pathlib import Path
from typing import Any, cast

import anyio
from pydantic import ValidationError

from app.ai import apply_ai_commands, run_plan_graph
from app.ai.agents.base import short_error
from app.core.errors import PreconditionFailedError
from app.db.models import EditPlanRecord, Job, Project, Source
from app.media import detect_silences
from app.planning import VIBES, BasicPlanSettings, SourceMeta, Vibe, build_basic_plan
from app.schemas.edit_plan import EditPlan
from app.services.plans import save_plan
from app.transcription import Transcript
from app.worker.context import JobContext, JobFailedError, Progress

SAVE_ATTEMPTS = 3
PLAN_MODES = ("basic", "ai")
logger = logging.getLogger(__name__)


def plan_params(params: dict[str, Any] | None) -> tuple[str, Vibe]:
    params = params or {}
    mode = str(params.get("mode") or "basic")
    if mode not in PLAN_MODES:
        raise JobFailedError(f"Unknown plan mode {mode!r}; use one of {', '.join(PLAN_MODES)}")
    vibe = str(params.get("vibe") or "energetic")
    if vibe not in VIBES:
        raise JobFailedError(f"Unknown vibe {vibe!r}; use one of {', '.join(VIBES)}")
    return mode, cast(Vibe, vibe)


async def run_plan(ctx: JobContext, job: Job, progress: Progress) -> dict[str, Any]:
    mode, vibe = plan_params(job.params)
    if job.source_id is None:
        raise JobFailedError("A plan job needs a source_id")
    async with ctx.sessionmaker() as session:
        source = await session.get(Source, job.source_id)
        if source is None or source.project_id != job.project_id:
            raise JobFailedError("Source not found")
        if source.proxy_key is None or not source.duration_ms or not source.width:
            raise JobFailedError("Source is not processed yet (the proxy job comes first)")
        if source.transcript_key is None:
            raise JobFailedError("Source has no transcript yet (run a transcribe job first)")
        project = await session.get(Project, source.project_id)
        meta = SourceMeta(
            id=str(source.id),
            src=source.proxy_key,
            width=source.width,
            height=source.height or source.width,
            duration_ms=source.duration_ms,
            title=(project.title if project else None) or "Untitled",
        )
        project_id = source.project_id
        transcript_key, audio_key = source.transcript_key, source.audio_key

    settings = ctx.settings
    work_dir = settings.work_dir
    if work_dir is not None:
        await anyio.Path(work_dir).mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(
        prefix="shortcraft-plan-", dir=work_dir, ignore_cleanup_errors=True
    ) as tmp_name:
        tmp = Path(tmp_name)
        await ctx.storage.download_to(transcript_key, tmp / "transcript.json")
        try:
            raw = await anyio.Path(tmp / "transcript.json").read_text(encoding="utf-8")
            transcript = Transcript.from_dict(json.loads(raw))
        except (ValueError, KeyError, TypeError) as exc:
            raise JobFailedError("The stored transcript could not be read") from exc
        await progress(20)

        silences: list[tuple[int, int]] = []
        if audio_key:
            await ctx.storage.download_to(audio_key, tmp / "audio-16k.wav")
            silences = await detect_silences(
                tmp / "audio-16k.wav",
                noise_db=settings.silence_noise_db,
                min_silence_s=settings.silence_min_s,
                duration_ms=meta.duration_ms,
                tools=ctx.tools,
                time_limit=float(settings.job_timeout_seconds),
            )
        await progress(60)

    data = build_basic_plan(
        meta,
        transcript.words,
        silences,
        BasicPlanSettings(
            vibe=vibe, min_pause_ms=settings.min_pause_ms, cut_padding_ms=settings.cut_padding_ms
        ),
    )
    try:
        plan = EditPlan.model_validate(data)
    except ValidationError as exc:
        raise JobFailedError(f"Built plan is invalid: {exc.error_count()} error(s)") from exc
    await progress(65)

    ai: dict[str, Any] | None = None
    warnings: list[str] = []
    if mode == "ai":
        data, plan, ai, warnings = await _improve_with_ai(ctx, data, plan, progress)
    await progress(90)

    revision = await _save(ctx, project_id, plan)
    counts: dict[str, int] = {}
    for cut in data["cuts"]["items"]:
        counts[cut["reason"]] = counts.get(cut["reason"], 0) + 1
    return {
        "source_id": str(meta.id),
        "mode": mode,
        "vibe": vibe,
        "revision": revision,
        "cuts": counts,
        "silences_detected": len(silences),
        "words": len(data["sources"][0]["words"]),
        "highlights": len(data["captions"]["highlights"]),
        "zooms": len(data["zooms"]["items"]),
        "hook": data["hook"]["text"],
        "mode_used": "ai" if ai is not None else "basic",
        "ai": ai,
        "warnings": warnings,
    }


async def _improve_with_ai(
    ctx: JobContext, data: dict[str, Any], plan: EditPlan, progress: Progress
) -> tuple[dict[str, Any], EditPlan, dict[str, Any] | None, list[str]]:
    """(data, plan, ai summary or None, warnings). Falls back to the basic plan on any AI
    problem; never raises for one."""
    models = ctx.ai_models()
    if not models.available:
        return (
            data,
            plan,
            None,
            ["AI agents are not configured (no OPENAI_API_KEY); saved the basic edit"],
        )
    done = 0
    total = 7  # prepare_context, 5 specialists, director

    async def on_event(event: dict[str, Any]) -> None:
        nonlocal done
        if event.get("status") in ("done", "failed") and event.get("node") != "validate":
            done += 1
            await progress(65 + min(total, done) * 3)

    limit = ctx.settings.ai_timeout_seconds * (ctx.settings.ai_max_retries + 1) * 2 + 30
    try:
        async with asyncio.timeout(limit):
            result = await run_plan_graph(data, models, on_event=on_event)
    except Exception as exc:
        message = short_error(exc)
        logger.warning("AI plan failed, keeping the basic plan: %s", message)
        return data, plan, None, [f"AI agents failed ({message}); saved the basic edit"]

    warnings = list(result.warnings)
    if not result.commands:
        warnings.append("AI agents suggested no changes; saved the basic edit")
        return data, plan, None, warnings
    improved, skipped = apply_ai_commands(data, result.commands)
    if skipped:
        warnings.append(f"Skipped unsupported AI commands: {', '.join(sorted(set(skipped)))}")
    try:
        improved_plan = EditPlan.model_validate(improved)
    except ValidationError as exc:
        warnings.append(f"AI edit was invalid ({exc.error_count()} error(s)); saved the basic edit")
        return data, plan, None, warnings
    summary = {
        "commands": len(result.commands),
        "changes": result.changes,
        "dropped": len(result.dropped),
        "failed_agents": result.failed_agents,
        "rationales": result.rationales,
    }
    return improved, improved_plan, summary, warnings


async def _save(ctx: JobContext, project_id: uuid.UUID, plan: EditPlan) -> int:
    """Save as the next revision, using the same If-Match rule as the API (the current
    revision); retried when an editor save lands in between."""
    for attempt in range(SAVE_ATTEMPTS):
        async with ctx.sessionmaker() as session:
            current = await session.get(EditPlanRecord, project_id)
            expected = current.revision if current else None
            try:
                record = await save_plan(session, project_id, plan, expected)
            except PreconditionFailedError:
                if attempt == SAVE_ATTEMPTS - 1:
                    raise JobFailedError("The plan kept changing while saving; try again") from None
                continue
            return record.revision
    raise JobFailedError("Could not save the plan")
