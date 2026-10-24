"""Hook agent: 3 hook-title options of at most 8 words, as `setHook`."""

from typing import Any

from pydantic import BaseModel

from app.ai.agents.base import AgentResult, Proposal, call_structured, load_prompt, messages
from app.ai.context import PlanIndex
from app.ai.models import AgentModels

NAME = "hook"
MAX_WORDS = 8
MAX_OPTIONS = 3
QUOTES = "\"'“”‘’"  # noqa: RUF001


class HookOutput(BaseModel):
    """Hook title options."""

    options: list[str]
    best: int
    rationale: str


def clean_hook(text: Any) -> str:
    """At most MAX_WORDS words, no wrapping quotes or hashtags."""
    if not isinstance(text, str):
        return ""
    words = text.replace("\n", " ").strip().strip(QUOTES).split()
    words = [w for w in words if not w.startswith("#")][:MAX_WORDS]
    return " ".join(words).rstrip(",;:-")


def to_result(output: dict[str, Any], index: PlanIndex) -> AgentResult:
    result = AgentResult(NAME, rationale=str(output.get("rationale") or ""))
    options: list[str] = []
    for raw in output.get("options") or []:
        text = clean_hook(raw)
        if text and text.lower() not in {o.lower() for o in options}:
            options.append(text)
    options = options[:MAX_OPTIONS]
    if not options:
        return result
    best = output.get("best")
    best = best if isinstance(best, int) and 0 <= best < len(options) else 0
    result.extra = {"options": options, "best": best}
    result.proposals.append(
        Proposal(
            id="hook-0",
            agent=NAME,
            kind="hook",
            command={
                "type": "setHook",
                "hook": {"enabled": True, "text": options[best], "options": options},
            },
            label="hook options: " + " | ".join(f"{i}: {o}" for i, o in enumerate(options)),
        )
    )
    return result


async def run(models: AgentModels, index: PlanIndex, context: str) -> AgentResult:
    output = await call_structured(models, NAME, HookOutput, messages(context, load_prompt(NAME)))
    return to_result(output, index)
