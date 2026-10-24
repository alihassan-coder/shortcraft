"""Caption agent: 1-2 highlights per sentence, sparse emojis, a preset for the vibe."""

from typing import Any, Literal

from pydantic import BaseModel, Field

from app.ai.agents.base import AgentResult, Proposal, call_structured, load_prompt, messages
from app.ai.commands import CAPTION_PRESET_IDS
from app.ai.context import PlanIndex
from app.ai.models import AgentModels

NAME = "caption"
PresetId = Literal[CAPTION_PRESET_IDS]  # type: ignore[valid-type]


class Highlight(BaseModel):
    word: int = Field(description="Word number to highlight")
    emoji: str | None = Field(description="One emoji for this word, or null")


class CaptionOutput(BaseModel):
    """Caption style and highlighted words."""

    preset_id: PresetId
    show_emojis: bool
    highlights: list[Highlight]
    rationale: str


def _emoji(value: Any) -> str | None:
    if not isinstance(value, str):
        return None
    value = value.strip()
    if not value or len(value) > 8 or any(ch.isalnum() for ch in value):
        return None
    return value


def to_result(output: dict[str, Any], index: PlanIndex) -> AgentResult:
    result = AgentResult(NAME, rationale=str(output.get("rationale") or ""))
    patch: dict[str, Any] = {}
    if output.get("preset_id") in CAPTION_PRESET_IDS:
        patch["presetId"] = output["preset_id"]
    if isinstance(output.get("show_emojis"), bool):
        patch["showEmojis"] = output["show_emojis"]
    if patch:
        result.proposals.append(
            Proposal(
                id="captions-0",
                agent=NAME,
                kind="captions",
                command={"type": "setCaptions", "captions": patch},
                label=f"captions {patch}",
            )
        )
    seen: set[str] = set()
    highlights = emojis = 0
    for item in output.get("highlights") or []:
        word = index.word(item.get("word"))
        if word is None or word.filler or word.id in seen:
            continue
        seen.add(word.id)
        common = {
            "agent": NAME,
            "source_id": word.source_id,
            "start_ms": word.start_ms,
            "end_ms": word.end_ms,
            "word_id": word.id,
        }
        result.proposals.append(
            Proposal(
                id=f"highlight-{highlights}",
                kind="highlight",
                command={"type": "toggleHighlight", "wordId": word.id},
                label=f'highlight #{word.index} "{word.text}"',
                **common,
            )
        )
        highlights += 1
        emoji = _emoji(item.get("emoji"))
        if emoji:
            result.proposals.append(
                Proposal(
                    id=f"emoji-{emojis}",
                    kind="emoji",
                    command={"type": "setEmoji", "wordId": word.id, "emoji": emoji},
                    label=f'emoji {emoji} on #{word.index} "{word.text}"',
                    **common,
                )
            )
            emojis += 1
    return result


async def run(models: AgentModels, index: PlanIndex, context: str) -> AgentResult:
    output = await call_structured(
        models, NAME, CaptionOutput, messages(context, load_prompt(NAME))
    )
    return to_result(output, index)
