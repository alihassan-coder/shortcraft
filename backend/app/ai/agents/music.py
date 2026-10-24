"""Music agent: mood -> a track id from the editor's library, as `setMusic`."""

from typing import Any, Literal

from pydantic import BaseModel

from app.ai.agents.base import (
    AgentResult,
    Proposal,
    call_structured,
    clamp,
    load_prompt,
    messages,
)
from app.ai.commands import MUSIC_TRACK_IDS
from app.ai.context import PlanIndex
from app.ai.models import AgentModels

NAME = "music"
TrackId = Literal[MUSIC_TRACK_IDS]  # type: ignore[valid-type]


class MusicOutput(BaseModel):
    """Background music choice."""

    track_id: TrackId
    volume: float
    ducking: bool
    mood: str
    rationale: str


def to_result(output: dict[str, Any], index: PlanIndex) -> AgentResult:
    result = AgentResult(NAME, rationale=str(output.get("rationale") or ""))
    track = output.get("track_id")
    if track not in MUSIC_TRACK_IDS:
        return result
    try:
        volume = round(clamp(float(output.get("volume") or 0.45), 0.2, 0.7), 2)
    except TypeError, ValueError:
        volume = 0.45
    music: dict[str, Any] = {"trackId": track, "volume": volume}
    if isinstance(output.get("ducking"), bool):
        music["ducking"] = output["ducking"]
    result.proposals.append(
        Proposal(
            id="music-0",
            agent=NAME,
            kind="music",
            command={"type": "setMusic", "music": music},
            label=f"music {track} volume {volume} ({output.get('mood') or 'no mood given'})",
        )
    )
    return result


async def run(models: AgentModels, index: PlanIndex, context: str) -> AgentResult:
    output = await call_structured(models, NAME, MusicOutput, messages(context, load_prompt(NAME)))
    return to_result(output, index)
