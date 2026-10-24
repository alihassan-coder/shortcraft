"""Zoom agent: punch-ins on punchlines and key points, as `addZoom` commands."""

from typing import Any, get_args

from pydantic import BaseModel, Field

from app.ai.agents.base import (
    AgentResult,
    Proposal,
    call_structured,
    clamp,
    load_prompt,
    messages,
)
from app.ai.commands import ZoomStyle
from app.ai.context import PlanIndex, words_text
from app.ai.models import AgentModels

NAME = "zoom"
MIN_ZOOM_MS = 600
MAX_ZOOM_MS = 4000
FOCUS_X, FOCUS_Y = 0.5, 0.33  # face focus comes later (MediaPipe, A5)
STYLES = get_args(ZoomStyle)


class ZoomPick(BaseModel):
    first_word: int
    last_word: int
    style: ZoomStyle
    scale: float = Field(description="1.05 to 1.4")
    reason: str


class ZoomOutput(BaseModel):
    """Zoom-ins to add."""

    zooms: list[ZoomPick]
    rationale: str


def _scale(value: Any) -> float:
    try:
        return round(clamp(float(value), 1.05, 1.4), 2)
    except TypeError, ValueError:
        return 1.2


def to_result(output: dict[str, Any], index: PlanIndex) -> AgentResult:
    result = AgentResult(NAME, rationale=str(output.get("rationale") or ""))
    for item in output.get("zooms") or []:
        first, last = index.word(item.get("first_word")), index.word(item.get("last_word"))
        if first is None or last is None or first.source_id != last.source_id:
            continue
        if last.index < first.index:
            first, last = last, first
        start = first.start_ms
        end = min(
            clamp(last.end_ms, start + MIN_ZOOM_MS, start + MAX_ZOOM_MS),
            index.durations[first.source_id],
        )
        if end <= start:
            continue
        style = item.get("style") if item.get("style") in STYLES else "punch"
        scale = _scale(item.get("scale"))
        span = index.words[first.index : last.index + 1]
        result.proposals.append(
            Proposal(
                id=f"zoom-{len(result.proposals)}",
                agent=NAME,
                kind="zoom",
                command={
                    "type": "addZoom",
                    "sourceId": first.source_id,
                    "atMs": start,
                    "zoom": {
                        "startMs": start,
                        "endMs": end,
                        "style": style,
                        "scale": scale,
                        "focusX": FOCUS_X,
                        "focusY": FOCUS_Y,
                    },
                },
                label=f'zoom {style} x{scale} #{first.index}-#{last.index} "{words_text(span)}"',
                source_id=first.source_id,
                start_ms=start,
                end_ms=end,
            )
        )
    return result


async def run(models: AgentModels, index: PlanIndex, context: str) -> AgentResult:
    output = await call_structured(models, NAME, ZoomOutput, messages(context, load_prompt(NAME)))
    return to_result(output, index)
