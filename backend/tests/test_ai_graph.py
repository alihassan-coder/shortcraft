"""The LangGraph workflows end to end with fake models (no network)."""

from typing import Any

import pytest

from app.ai import apply_ai_commands, run_edit_graph, run_plan_graph
from app.ai.graph import EDIT_NODES, PLAN_NODES, stream_edit_graph
from app.schemas.edit_plan import EditPlan
from tests.ai_fakes import SPECIALISTS, FakeAgentModels, fixture_plan, last_prompt

pytestmark = pytest.mark.unit

CALMER: dict[str, Any] = {
    "ok": True,
    "message": None,
    "changes": ["Captions set to Clean", "Emojis turned off", "Music: Just Chill"],
    "commands": [
        {"type": "setVibe", "vibe": "clean"},
        {"type": "setCaptions", "captions": {"showEmojis": False}},
        {"type": "updateAllZooms", "patch": {"style": "smooth", "scale": 1.12}},
        {"type": "setMusic", "music": {"trackId": "just-chill", "volume": 0.35}},
    ],
}


async def test_plan_graph_runs_specialists_in_parallel_then_director() -> None:
    plan = fixture_plan()
    models = FakeAgentModels(SPECIALISTS)
    events: list[dict[str, Any]] = []

    async def on_event(event: dict[str, Any]) -> None:
        events.append(event)

    result = await run_plan_graph(plan, models, on_event=on_event)

    assert result.warnings == [] and result.failed_agents == []
    nodes = [e["node"] for e in events if e["status"] == "done"]
    assert set(nodes) == set(PLAN_NODES)
    # Fan-out: all five specialists start before any of them finishes; director after all.
    statuses = [(e["node"], e["status"]) for e in events]
    first_done = min(
        statuses.index((n, "done")) for n in ("cut", "caption", "zoom", "hook", "music")
    )
    assert all(statuses.index((n, "started")) < first_done for n in ("cut", "caption", "zoom"))
    assert statuses.index(("director", "started")) > max(
        statuses.index((n, "done")) for n in ("cut", "caption", "zoom", "hook", "music")
    )
    # The Director saw the proposals and its choices were applied.
    assert "- zoom-2: zoom punch x1.4 #30-#30" in last_prompt(models.get_chat_model("director"))
    after, skipped = apply_ai_commands(plan, result.commands)
    assert skipped == []
    EditPlan.model_validate(after)
    assert after["hook"]["text"] == "Stop the scroll"  # director's hook_option 2
    assert [z["startMs"] for z in after["zooms"]["items"]] == [5090]  # zoom-2 dropped
    assert after["music"]["trackId"] == "epic-drums"
    assert after["captions"]["presetId"] == "beast"
    assert "Cut 1 repeated take" in result.changes
    assert result.rationales["director"] == "Keep it tight."


async def test_a_failing_specialist_only_loses_its_part() -> None:
    plan = fixture_plan()
    responses = {**SPECIALISTS, "zoom": TimeoutError("read timed out")}
    result = await run_plan_graph(plan, FakeAgentModels(responses))
    assert result.failed_agents == ["zoom"]
    assert result.warnings == ["zoom agent failed (TimeoutError: read timed out)"]
    after, _ = apply_ai_commands(plan, result.commands)
    assert after["zooms"] == plan["zooms"]  # basic zooms kept
    assert after["hook"]["text"] == "Stop the scroll"


async def test_director_failure_falls_back_to_rules() -> None:
    plan = fixture_plan()
    responses = {**SPECIALISTS, "director": RuntimeError("500 from upstream")}
    result = await run_plan_graph(plan, FakeAgentModels(responses))
    assert result.warnings == [
        "director review failed (RuntimeError: 500 from upstream); merged by rules only"
    ]
    after, _ = apply_ai_commands(plan, result.commands)
    assert after["hook"]["text"] == "Your first 3 seconds decide everything"  # hook's own best


async def test_fallback_model_is_used_when_the_primary_fails() -> None:
    plan = fixture_plan()
    responses = {**SPECIALISTS, "music": RuntimeError("rate limited")}
    fallback = {"music": {**SPECIALISTS["music"], "track_id": "forest-walk"}}
    result = await run_plan_graph(plan, FakeAgentModels(responses, fallback=fallback))
    assert result.warnings == []
    assert {
        "type": "setMusic",
        "music": {"trackId": "forest-walk", "volume": 0.7, "ducking": True},
    } in result.commands


async def test_edit_graph_make_it_calmer() -> None:
    plan = fixture_plan()
    models = FakeAgentModels({"edit": CALMER})
    events: list[dict[str, Any]] = []

    async def on_event(event: dict[str, Any]) -> None:
        events.append(event)

    result = await run_edit_graph(plan, "make it calmer", models, on_event=on_event)
    assert result.ok and result.message is None
    assert result.commands == CALMER["commands"]
    assert result.changes == CALMER["changes"]
    assert [e["node"] for e in events if e["status"] == "done"] == list(EDIT_NODES)
    prompt = last_prompt(models.get_chat_model("edit"))
    assert prompt.rstrip().endswith("Creator's request: make it calmer")  # volatile part last
    assert prompt.index("# TRANSCRIPT") < prompt.index("Creator's request")


async def test_edit_graph_resolves_word_refs_and_reports_drops() -> None:
    reply = {
        "ok": True,
        "message": None,
        "changes": ["Cut the sentence about scrolling"],
        "commands": [
            {"type": "cutRange", "sourceId": "S0", "startMs": 7570, "endMs": 9250},
            {"type": "toggleHighlight", "wordId": "#24"},
            {"type": "setEmoji", "wordId": "#400", "emoji": "x"},
        ],
    }
    result = await run_edit_graph(
        fixture_plan(), "cut the scroll line", FakeAgentModels({"edit": reply})
    )
    assert result.commands == [
        {"type": "cutRange", "sourceId": "src-1", "startMs": 7570, "endMs": 9250},
        {"type": "toggleHighlight", "wordId": "w24"},
    ]
    assert result.dropped == [{"index": 2, "type": "setEmoji", "reason": "unknown word '#400'"}]
    assert result.changes == ["Cut 1 part", "Highlighted 1 key word"]  # rebuilt after drops


async def test_edit_graph_unclear_request() -> None:
    reply = {"ok": False, "message": "Which part should I cut?", "changes": [], "commands": []}
    result = await run_edit_graph(fixture_plan(), "do the thing", FakeAgentModels({"edit": reply}))
    assert (result.ok, result.commands, result.changes) == (False, [], [])
    assert result.message == "Which part should I cut?"


async def test_stream_edit_graph_yields_progress_then_result() -> None:
    kinds: list[str] = []
    final = None
    async for kind, payload in stream_edit_graph(
        fixture_plan(), "calmer", FakeAgentModels({"edit": CALMER})
    ):
        kinds.append(kind)
        final = payload
    assert kinds[-1] == "result" and kinds.count("result") == 1
    assert kinds.count("progress") == 2 * len(EDIT_NODES)
    assert final is not None and final.ok
