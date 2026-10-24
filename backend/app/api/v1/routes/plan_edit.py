"""'Describe a change': natural-language edit requests -> edit commands (nothing is saved).

The editor applies the returned commands with its own `applyEdit` (so undo works) and then
saves through PUT /plan as usual.
"""

import asyncio
import json
import logging
import uuid
from collections.abc import AsyncIterator
from typing import Any

from fastapi import APIRouter, Request
from fastapi.responses import StreamingResponse

from app.ai.agents.base import short_error
from app.ai.graph import run_edit_graph, stream_edit_graph
from app.ai.models import AgentModels, AIUnavailableError
from app.ai.ratelimit import TokenBucket
from app.api.deps import SessionDep, SettingsDep
from app.core.config import Settings
from app.core.errors import (
    PreconditionFailedError,
    RateLimitedError,
    ServiceUnavailableError,
    UpstreamError,
)
from app.schemas.plan_edit import PlanEditRequest, PlanEditResponse
from app.services import plans as service

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/projects/{project_id}/plan", tags=["ai"])

UNAVAILABLE = "AI editing is not configured on this server (OPENAI_API_KEY is not set)"


def _timeout(settings: Settings) -> float:
    return settings.ai_timeout_seconds * (settings.ai_max_retries + 1) + 10


async def _prepare(
    project_id: uuid.UUID, body: PlanEditRequest, request: Request, session: SessionDep
) -> tuple[dict[str, Any], AgentModels]:
    record = await service.get_plan(session, project_id)
    if record.revision != body.plan_revision:
        raise PreconditionFailedError(
            f"Plan revision is {record.revision}, not {body.plan_revision}; save or reload first"
        )
    models: AgentModels = request.app.state.agent_models
    if not models.available:
        raise ServiceUnavailableError(UNAVAILABLE)
    limiter: TokenBucket = request.app.state.edit_limiter
    wait = limiter.take(str(project_id))
    if wait > 0:
        retry = limiter.retry_after(wait)
        raise RateLimitedError(
            f"Too many edit requests for this project; try again in {retry} s", retry_after=retry
        )
    return record.plan, models


@router.post("/edit", response_model=PlanEditResponse)
async def edit_plan(
    project_id: uuid.UUID,
    body: PlanEditRequest,
    request: Request,
    session: SessionDep,
    settings: SettingsDep,
):
    """Turn a request like "make it calmer" into edit commands for the plan at
    `plan_revision`. 412 if the plan moved on, 429 when rate limited, 503 without an OpenAI
    key, 502 if the AI call fails."""
    plan, models = await _prepare(project_id, body, request, session)
    try:
        async with asyncio.timeout(_timeout(settings)):
            result = await run_edit_graph(plan, body.request, models)
    except AIUnavailableError as exc:
        raise ServiceUnavailableError(UNAVAILABLE) from exc
    except Exception as exc:
        logger.warning("Plan edit failed for project %s: %s", project_id, short_error(exc))
        raise UpstreamError("The AI could not answer right now; please try again") from exc
    return PlanEditResponse(**result.as_dict())


def _sse(event: str, data: Any) -> str:
    return f"event: {event}\ndata: {json.dumps(data, ensure_ascii=False)}\n\n"


@router.post("/edit/stream")
async def edit_plan_stream(
    project_id: uuid.UUID,
    body: PlanEditRequest,
    request: Request,
    session: SessionDep,
    settings: SettingsDep,
):
    """Same as POST /plan/edit as Server-Sent Events: `progress` events
    (`{"node", "status", "detail"?}`) while the graph runs, then one `result` event (the
    POST /plan/edit body) or one `error` event (`{"code", "message"}`). Errors found before
    the AI runs (404, 412, 422, 429, 503) are normal JSON responses."""
    plan, models = await _prepare(project_id, body, request, session)

    async def events() -> AsyncIterator[str]:
        try:
            async with asyncio.timeout(_timeout(settings)):
                async for kind, payload in stream_edit_graph(plan, body.request, models):
                    if kind == "progress":
                        yield _sse("progress", payload)
                    else:
                        yield _sse("result", PlanEditResponse(**payload.as_dict()).model_dump())
        except Exception as exc:
            logger.warning("Plan edit stream failed for %s: %s", project_id, short_error(exc))
            yield _sse(
                "error",
                {
                    "code": "ai_error",
                    "message": "The AI could not answer right now; please try again",
                },
            )

    return StreamingResponse(
        events(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )
