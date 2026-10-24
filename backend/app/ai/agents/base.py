"""Shared pieces of the agent nodes: prompts, the structured call, proposals."""

from dataclasses import dataclass, field
from functools import cache
from pathlib import Path
from typing import Any, Literal

from langchain_core.messages import BaseMessage, HumanMessage, SystemMessage
from pydantic import BaseModel

from app.ai.models import AgentModels, Role

PROMPTS_DIR = Path(__file__).resolve().parents[1] / "prompts"

ProposalKind = Literal["cut", "captions", "highlight", "emoji", "zoom", "hook", "music"]


@cache
def load_prompt(name: str) -> str:
    return (PROMPTS_DIR / f"{name}.md").read_text(encoding="utf-8").strip()


@dataclass(slots=True)
class Proposal:
    """One suggested edit. `command` is wire JSON (TS `EditCommand`) with real ids."""

    id: str
    agent: str
    kind: ProposalKind
    command: dict[str, Any]
    label: str
    source_id: str | None = None
    start_ms: float | None = None
    end_ms: float | None = None
    word_id: str | None = None


@dataclass(slots=True)
class AgentResult:
    agent: str
    proposals: list[Proposal] = field(default_factory=list)
    rationale: str = ""
    extra: dict[str, Any] = field(default_factory=dict)
    error: str | None = None


def messages(context: str, task: str) -> list[BaseMessage]:
    """Shared preamble + plan/transcript first (identical for every agent, so the prefix is
    cacheable), the agent's own task last."""
    return [
        SystemMessage(load_prompt("shared")),
        HumanMessage(context),
        SystemMessage(task),
    ]


def as_dict(value: Any) -> dict[str, Any]:
    if isinstance(value, BaseModel):
        return value.model_dump(mode="json")
    if isinstance(value, dict):
        return value
    raise TypeError(f"Structured output was {type(value).__name__}, not an object")


async def call_structured(
    models: AgentModels,
    role: Role,
    schema: Any,
    msgs: list[BaseMessage],
    *,
    strict: bool | None = True,
) -> dict[str, Any]:
    runnable = models.structured(role, schema, strict=strict)
    return as_dict(await runnable.ainvoke(msgs))


def clamp(value: float, low: float, high: float) -> float:
    return max(low, min(high, value))


def short_error(exc: BaseException) -> str:
    """A one-line, secret-free description of an agent failure."""
    text = str(exc).splitlines()[0] if str(exc) else ""
    if "sk-" in text or "api_key" in text.lower() or "authorization" in text.lower():
        text = ""
    return f"{type(exc).__name__}: {text[:160]}" if text else type(exc).__name__
