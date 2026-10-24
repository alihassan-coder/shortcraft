"""Cut agent: retakes the heuristic missed (judgment), as `cutRange` commands."""

from typing import Any

from pydantic import BaseModel, Field

from app.ai.agents.base import AgentResult, Proposal, call_structured, load_prompt, messages
from app.ai.context import PlanIndex, words_text
from app.ai.models import AgentModels

NAME = "cut"
MAX_SPAN_WORDS = 40
DEFAULT_NOTE = "You said this twice. Kept the second take."


class Retake(BaseModel):
    first_word: int = Field(description="Number of the first word to remove")
    last_word: int = Field(description="Number of the last word to remove (inclusive)")
    note: str = Field(description="Short note for the creator")


class CutOutput(BaseModel):
    """Retakes to cut."""

    retakes: list[Retake]
    rationale: str


def to_result(output: dict[str, Any], index: PlanIndex) -> AgentResult:
    result = AgentResult(NAME, rationale=str(output.get("rationale") or ""))
    for item in output.get("retakes") or []:
        first, last = index.word(item.get("first_word")), index.word(item.get("last_word"))
        if first is None or last is None or first.source_id != last.source_id:
            continue
        if last.index < first.index or last.index - first.index + 1 > MAX_SPAN_WORDS:
            continue
        span = index.words[first.index : last.index + 1]
        if all(w.cut for w in span):
            continue
        note = str(item.get("note") or "").strip()[:200] or DEFAULT_NOTE
        result.proposals.append(
            Proposal(
                id=f"cut-{len(result.proposals)}",
                agent=NAME,
                kind="cut",
                command={
                    "type": "cutRange",
                    "sourceId": first.source_id,
                    "startMs": first.start_ms,
                    "endMs": last.end_ms,
                    "note": note,
                },
                label=f'cut #{first.index}-#{last.index} "{words_text(span)}"',
                source_id=first.source_id,
                start_ms=first.start_ms,
                end_ms=last.end_ms,
            )
        )
    return result


async def run(models: AgentModels, index: PlanIndex, context: str) -> AgentResult:
    output = await call_structured(models, NAME, CutOutput, messages(context, load_prompt(NAME)))
    return to_result(output, index)
