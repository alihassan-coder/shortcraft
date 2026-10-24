"""LangGraph workflows.

Full first edit (plan job, mode "ai"):

    START -> prepare_context -> cut | caption | zoom | hook | music (in parallel)
          -> director -> validate -> END

"Describe a change" (POST /plan/edit):

    START -> summarize_plan -> edit_director -> validate -> END

Nodes report progress through LangGraph's custom stream (`get_stream_writer`) as
`{"node", "status": "started" | "done" | "failed", "detail"?}`; `run_*` pass those events to
an optional callback and `stream_edit_graph` yields them. A specialist that fails only loses
its own part (a warning is recorded); the Director's code rules run even if its LLM review
fails.
"""

import logging
import operator
from collections.abc import AsyncIterator, Awaitable, Callable
from dataclasses import dataclass, field
from typing import Annotated, Any, TypedDict

from langgraph.config import get_stream_writer
from langgraph.graph import END, START, StateGraph

from app.ai.agents import caption, cut, director, edit, hook, music, zoom
from app.ai.agents.base import AgentResult, short_error
from app.ai.context import PlanIndex, build_context
from app.ai.models import AgentModels
from app.ai.rules import describe_changes, validate_commands

logger = logging.getLogger(__name__)

Event = dict[str, Any]
OnEvent = Callable[[Event], Awaitable[None]]
Specialist = Callable[[AgentModels, PlanIndex, str], Awaitable[AgentResult]]

SPECIALISTS: dict[str, Specialist] = {
    "cut": cut.run,
    "caption": caption.run,
    "zoom": zoom.run,
    "hook": hook.run,
    "music": music.run,
}
PLAN_NODES = ("prepare_context", *SPECIALISTS, "director", "validate")
EDIT_NODES = ("summarize_plan", "edit_director", "validate")


def _emit(node: str, status: str, detail: str | None = None) -> None:
    event: Event = {"node": node, "status": status}
    if detail:
        event["detail"] = detail
    get_stream_writer()(event)


# --- full first edit -----------------------------------------------------------------------


class PlanState(TypedDict, total=False):
    plan: dict[str, Any]
    index: PlanIndex
    context: str
    results: Annotated[list[AgentResult], operator.add]
    raw_commands: list[dict[str, Any]]
    rationale: str
    commands: list[dict[str, Any]]
    dropped: list[dict[str, Any]]
    changes: list[str]
    warnings: Annotated[list[str], operator.add]


def build_plan_graph(models: AgentModels) -> Any:
    async def prepare_context(state: PlanState) -> dict[str, Any]:
        _emit("prepare_context", "started")
        index = PlanIndex.build(state["plan"])
        _emit("prepare_context", "done", f"{len(index.words)} words")
        return {"index": index, "context": build_context(index)}

    def specialist(name: str, run: Specialist) -> Callable[[PlanState], Awaitable[dict]]:
        async def node(state: PlanState) -> dict[str, Any]:
            _emit(name, "started")
            try:
                result = await run(models, state["index"], state["context"])
            except Exception as exc:
                message = short_error(exc)
                logger.warning("Agent %s failed: %s", name, message)
                _emit(name, "failed", message)
                return {
                    "results": [AgentResult(name, error=message)],
                    "warnings": [f"{name} agent failed ({message})"],
                }
            _emit(name, "done", f"{len(result.proposals)} proposals")
            return {"results": [result]}

        node.__name__ = name
        return node

    async def director_node(state: PlanState) -> dict[str, Any]:
        _emit("director", "started")
        results = state.get("results", [])
        index = state["index"]
        hook_result = next((r for r in results if r.agent == "hook"), None)
        hook_option = int((hook_result.extra if hook_result else {}).get("best", 0))
        drop: set[str] = set()
        rationale = ""
        warnings: list[str] = []
        ids = {p.id for r in results for p in r.proposals}
        if ids:
            try:
                decision = await director.review(models, state["context"], results)
                drop = {d for d in decision.get("drop") or [] if d in ids}
                option = decision.get("hook_option")
                if isinstance(option, int) and not isinstance(option, bool):
                    hook_option = option
                rationale = str(decision.get("rationale") or "")
            except Exception as exc:
                message = short_error(exc)
                logger.warning("Director review failed: %s", message)
                warnings.append(f"director review failed ({message}); merged by rules only")
        raw = director.merge(index, results, drop=drop, hook_option=hook_option)
        _emit("director", "done", f"{len(raw)} commands, {len(drop)} proposals dropped")
        return {"raw_commands": raw, "rationale": rationale, "warnings": warnings}

    async def validate(state: PlanState) -> dict[str, Any]:
        _emit("validate", "started")
        index = state["index"]
        commands, dropped = validate_commands(state.get("raw_commands", []), index)
        _emit("validate", "done", f"{len(commands)} commands kept")
        return {
            "commands": commands,
            "dropped": [d.as_dict() for d in dropped],
            "changes": describe_changes(commands, index),
        }

    graph = StateGraph(PlanState)
    graph.add_node("prepare_context", prepare_context)
    for name, run in SPECIALISTS.items():
        graph.add_node(name, specialist(name, run))
    graph.add_node("director", director_node)
    graph.add_node("validate", validate)
    graph.add_edge(START, "prepare_context")
    for name in SPECIALISTS:
        graph.add_edge("prepare_context", name)
    graph.add_edge(list(SPECIALISTS), "director")  # fan-in: runs once, after all five
    graph.add_edge("director", "validate")
    graph.add_edge("validate", END)
    return graph.compile()


@dataclass(slots=True)
class PlanGraphResult:
    commands: list[dict[str, Any]]
    changes: list[str]
    dropped: list[dict[str, Any]] = field(default_factory=list)
    warnings: list[str] = field(default_factory=list)
    rationales: dict[str, str] = field(default_factory=dict)
    failed_agents: list[str] = field(default_factory=list)


async def _run(graph: Any, state: dict[str, Any], on_event: OnEvent | None) -> dict[str, Any]:
    final: dict[str, Any] = {}
    async for chunk in graph.astream(state, stream_mode=["values", "custom"], version="v2"):
        if chunk["type"] == "values":
            final = chunk["data"]
        elif chunk["type"] == "custom" and on_event is not None:
            await on_event(chunk["data"])
    return final


async def run_plan_graph(
    plan: dict[str, Any], models: AgentModels, *, on_event: OnEvent | None = None
) -> PlanGraphResult:
    final = await _run(build_plan_graph(models), {"plan": plan, "results": []}, on_event)
    results: list[AgentResult] = final.get("results", [])
    rationales = {r.agent: r.rationale for r in results if r.rationale}
    if final.get("rationale"):
        rationales["director"] = final["rationale"]
    return PlanGraphResult(
        commands=final.get("commands", []),
        changes=final.get("changes", []),
        dropped=final.get("dropped", []),
        warnings=final.get("warnings", []),
        rationales=rationales,
        failed_agents=sorted(r.agent for r in results if r.error),
    )


# --- describe a change -----------------------------------------------------------------------


class EditState(TypedDict, total=False):
    plan: dict[str, Any]
    request: str
    index: PlanIndex
    context: str
    reply: dict[str, Any]
    commands: list[dict[str, Any]]
    dropped: list[dict[str, Any]]
    changes: list[str]
    ok: bool
    message: str | None


def build_edit_graph(models: AgentModels) -> Any:
    async def summarize_plan(state: EditState) -> dict[str, Any]:
        _emit("summarize_plan", "started")
        index = PlanIndex.build(state["plan"])
        _emit("summarize_plan", "done")
        return {"index": index, "context": build_context(index)}

    async def edit_director(state: EditState) -> dict[str, Any]:
        _emit("edit_director", "started")
        reply = await edit.run(models, state["context"], state["request"])
        _emit("edit_director", "done", f"{len(reply.get('commands') or [])} commands")
        return {"reply": reply}

    async def validate(state: EditState) -> dict[str, Any]:
        _emit("validate", "started")
        index, reply = state["index"], state["reply"]
        raw = reply.get("commands") if isinstance(reply.get("commands"), list) else []
        commands, dropped = validate_commands(raw, index)
        llm_changes = [str(c) for c in reply.get("changes") or [] if str(c).strip()]
        # The model's own wording when every command survived; else describe what is left.
        changes = llm_changes if llm_changes and not dropped else describe_changes(commands, index)
        message = reply.get("message") if isinstance(reply.get("message"), str) else None
        ok = bool(commands)
        if not ok and not message:
            message = "I couldn't turn that into an edit. Try describing the change differently."
        _emit("validate", "done", f"{len(commands)} commands kept")
        return {
            "commands": commands,
            "dropped": [d.as_dict() for d in dropped],
            "changes": changes if ok else [],
            "ok": ok,
            "message": message,
        }

    graph = StateGraph(EditState)
    graph.add_node("summarize_plan", summarize_plan)
    graph.add_node("edit_director", edit_director)
    graph.add_node("validate", validate)
    graph.add_edge(START, "summarize_plan")
    graph.add_edge("summarize_plan", "edit_director")
    graph.add_edge("edit_director", "validate")
    graph.add_edge("validate", END)
    return graph.compile()


@dataclass(slots=True)
class EditResult:
    ok: bool
    commands: list[dict[str, Any]]
    changes: list[str]
    message: str | None = None
    dropped: list[dict[str, Any]] = field(default_factory=list)

    def as_dict(self) -> dict[str, Any]:
        return {
            "ok": self.ok,
            "commands": self.commands,
            "changes": self.changes,
            "message": self.message,
            "dropped": self.dropped,
        }


def _edit_result(final: dict[str, Any]) -> EditResult:
    return EditResult(
        ok=bool(final.get("ok")),
        commands=final.get("commands", []),
        changes=final.get("changes", []),
        message=final.get("message"),
        dropped=final.get("dropped", []),
    )


async def run_edit_graph(
    plan: dict[str, Any],
    request: str,
    models: AgentModels,
    *,
    on_event: OnEvent | None = None,
) -> EditResult:
    final = await _run(build_edit_graph(models), {"plan": plan, "request": request}, on_event)
    return _edit_result(final)


async def stream_edit_graph(
    plan: dict[str, Any], request: str, models: AgentModels
) -> AsyncIterator[tuple[str, Any]]:
    """("progress", event) for each node event, then ("result", EditResult)."""
    final: dict[str, Any] = {}
    graph = build_edit_graph(models)
    state = {"plan": plan, "request": request}
    async for chunk in graph.astream(state, stream_mode=["values", "custom"], version="v2"):
        if chunk["type"] == "values":
            final = chunk["data"]
        elif chunk["type"] == "custom":
            yield "progress", chunk["data"]
    yield "result", _edit_result(final)
