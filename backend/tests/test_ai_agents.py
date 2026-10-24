"""Agent nodes, Director conflict rules and the validate step (fake models, no network)."""

import itertools
from typing import Any

import pytest

from app.ai.agents import caption, cut, director, hook, music, zoom
from app.ai.agents.base import AgentResult
from app.ai.apply import apply_ai_commands, kept_speech_ratio
from app.ai.context import PlanIndex, build_context
from app.ai.rules import describe_changes, validate_commands
from tests.ai_fakes import SPECIALISTS, FakeAgentModels, fixture_plan, last_prompt

pytestmark = pytest.mark.unit


@pytest.fixture
def index() -> PlanIndex:
    return PlanIndex.build(fixture_plan())


async def run_agent(module: Any, index: PlanIndex, response: Any) -> AgentResult:
    models = FakeAgentModels({module.NAME: response})
    result = await module.run(models, index, build_context(index))
    prompt = last_prompt(models.get_chat_model(module.NAME))
    assert "# TRANSCRIPT" in prompt and "[12] getting (3650-3910)" in prompt
    return result


async def test_cut_agent(index: PlanIndex) -> None:
    result = await run_agent(
        cut,
        index,
        {
            "retakes": [
                {"first_word": 48, "last_word": 54, "note": ""},
                {"first_word": 2, "last_word": 7, "note": "already cut"},  # all X: skipped
                {"first_word": 30, "last_word": 20, "note": "backwards"},  # skipped
                {"first_word": 0, "last_word": 99, "note": "unknown word"},  # skipped
            ],
            "rationale": "One restart at the end.",
        },
    )
    assert [p.command for p in result.proposals] == [
        {
            "type": "cutRange",
            "sourceId": "src-1",
            "startMs": 17760,
            "endMs": 19610,
            "note": cut.DEFAULT_NOTE,
        }
    ]
    assert result.rationale == "One restart at the end."


async def test_caption_agent(index: PlanIndex) -> None:
    result = await run_agent(caption, index, SPECIALISTS["caption"])
    kinds = [(p.kind, p.word_id) for p in result.proposals]
    assert kinds[0] == ("captions", None)
    assert result.proposals[0].command == {
        "type": "setCaptions",
        "captions": {"presetId": "beast", "showEmojis": True},
    }
    assert ("highlight", "w1") not in kinds  # filler
    assert [w for k, w in kinds if k == "highlight"] == ["w13", "w18", "w24", "w34", "w52"]
    assert [p.command for p in result.proposals if p.kind == "emoji"] == [
        {"type": "setEmoji", "wordId": "w24", "emoji": "\U0001f4a8"}
    ]


async def test_caption_agent_rejects_unknown_presets(index: PlanIndex) -> None:
    bad = {**SPECIALISTS["caption"], "preset_id": "comic-sans"}
    with pytest.raises(Exception, match="preset_id"):  # schema validation, like a real model
        await run_agent(caption, index, bad)
    # Pure conversion ignores it instead.
    result = caption.to_result({**bad, "highlights": [{"word": 12, "emoji": "abc"}]}, index)
    assert result.proposals[0].command == {"type": "setCaptions", "captions": {"showEmojis": True}}
    assert [p.kind for p in result.proposals] == ["captions", "highlight"]  # "abc" is no emoji


async def test_zoom_agent(index: PlanIndex) -> None:
    result = await run_agent(zoom, index, SPECIALISTS["zoom"])
    first = result.proposals[0].command
    assert first == {
        "type": "addZoom",
        "sourceId": "src-1",
        "atMs": 5090,
        "zoom": {
            "startMs": 5090,
            "endMs": 6110,
            "style": "punch",
            "scale": 1.25,
            "focusX": 0.5,
            "focusY": 0.33,
        },
    }
    assert result.proposals[2].command["zoom"]["scale"] == 1.4  # 3 clamped
    one_word = result.proposals[2].command["zoom"]
    assert one_word["endMs"] - one_word["startMs"] >= zoom.MIN_ZOOM_MS


async def test_hook_agent(index: PlanIndex) -> None:
    result = await run_agent(hook, index, SPECIALISTS["hook"])
    options = result.extra["options"]
    assert options == [
        "Your first 3 seconds decide everything",
        "Why nobody watches your videos past three seconds",  # quotes off, 8 words max
        "Stop the scroll",
    ]
    assert all(len(o.split()) <= 8 for o in options)
    assert result.proposals[0].command["hook"]["text"] == options[0]


async def test_music_agent(index: PlanIndex) -> None:
    result = await run_agent(music, index, SPECIALISTS["music"])
    assert result.proposals[0].command == {
        "type": "setMusic",
        "music": {"trackId": "epic-drums", "volume": 0.7, "ducking": True},
    }
    with pytest.raises(Exception, match="track_id"):
        await run_agent(music, index, {**SPECIALISTS["music"], "track_id": "lofi-beats"})


# --- director ----------------------------------------------------------------------------


def specialist_results(index: PlanIndex) -> list[AgentResult]:
    return [
        module.to_result(SPECIALISTS[module.NAME], index)
        for module in (cut, caption, zoom, hook, music)
    ]


def test_director_resolves_conflicts(index: PlanIndex) -> None:
    commands = director.merge(index, specialist_results(index), drop={"zoom-2"}, hook_option=2)
    kinds = [c["type"] for c in commands]
    assert kinds[0] == "cutRange"  # cuts first
    adds = [c for c in commands if c["type"] == "addZoom"]
    # zoom-1 overlaps zoom-0, zoom-2 was dropped, zoom-3 sits inside the new cut.
    assert [z["atMs"] for z in adds] == [5090]
    # The basic zooms are replaced.
    assert [c["zoomId"] for c in commands if c["type"] == "removeZoom"] == [
        "zoom-0",
        "zoom-1",
        "zoom-2",
    ]
    toggles = {c["wordId"] for c in commands if c["type"] == "toggleHighlight"}
    after, _ = apply_ai_commands(index.plan, commands)
    assert "w52" not in after["captions"]["highlights"]  # cut word: never highlighted
    assert set(after["captions"]["highlights"]) == {"w13", "w18", "w24", "w34"}
    assert "w34" not in toggles  # already highlighted: no toggle (it would remove it)
    assert after["hook"]["text"] == "Stop the scroll"
    assert after["captions"]["emojis"] == {"w24": "\U0001f4a8"}


def test_director_caps_and_skips_failed_agents(index: PlanIndex) -> None:
    many = {
        "zooms": [
            {"first_word": i, "last_word": i, "style": "punch", "scale": 1.2, "reason": ""}
            for i in range(8, 47)
        ],
        "rationale": "",
    }
    results = [zoom.to_result(many, index), AgentResult("caption", error="TimeoutError")]
    commands = director.merge(index, results)
    adds = [c for c in commands if c["type"] == "addZoom"]
    assert 1 <= len(adds) <= 20000 // director.ZOOM_EVERY_MS
    starts = [c["atMs"] for c in adds]
    assert all(b - a >= director.MIN_ZOOM_GAP_MS for a, b in itertools.pairwise(starts))
    # A failed caption agent leaves the basic highlights alone.
    assert not any(c["type"] in ("toggleHighlight", "setEmoji") for c in commands)


def test_director_prompt_lists_proposals(index: PlanIndex) -> None:
    text = director.proposals_text([*specialist_results(index), AgentResult("x", error="boom")])
    assert "- cut-0: cut #48-#54" in text
    assert "- zoom-0: zoom punch x1.25 #17-#19" in text
    assert "(this specialist failed" in text


# --- validate ----------------------------------------------------------------------------


def test_validate_resolves_refs_clamps_and_dedupes(index: PlanIndex) -> None:
    raw = [
        {"type": "toggleHighlight", "wordId": "#12"},
        {"type": "toggleHighlight", "wordId": 12},  # same word again: duplicate
        {"type": "setEmoji", "wordId": "#999", "emoji": "x"},  # unknown word
        {"type": "cutRange", "sourceId": "S0", "startMs": 19000, "endMs": 99999},
        {"type": "cutRange", "sourceId": "S0", "startMs": 30000, "endMs": 40000},  # empty
        {"type": "addZoom", "sourceId": "S0", "atMs": 50000, "zoom": {"endMs": 90000}},
        {"type": "removeZoom", "zoomId": "zoom-9"},  # unknown zoom
        {"type": "toggleRestoreCut", "cutId": "silence-0"},
        {"type": "setCaptions", "captions": {"presetId": "nope"}},  # unknown preset
        {"type": "setMusic", "music": {"trackId": "lofi"}},  # unknown track
        {"type": "teleport"},
    ]
    commands, dropped = validate_commands(raw, index)
    assert commands == [
        {"type": "toggleHighlight", "wordId": "w12"},
        {"type": "cutRange", "sourceId": "src-1", "startMs": 19000, "endMs": 20000},
        {"type": "addZoom", "sourceId": "src-1", "atMs": 20000, "zoom": {"endMs": 20000}},
        {"type": "toggleRestoreCut", "cutId": "silence-0"},
    ]
    reasons = {d.index: d.reason for d in dropped}
    assert reasons == {
        1: "duplicate command",
        2: "unknown word '#999'",
        4: "empty cut range",
        6: "unknown zoom 'zoom-9'",
        8: "unknown caption preset 'nope'",
        9: "unknown music track 'lofi'",
        10: "unsupported command type 'teleport'",
    }


def test_validate_keeps_at_least_60_percent_of_speech(index: PlanIndex) -> None:
    raw = [
        {"type": "setVibe", "vibe": "clean"},
        {"type": "cutRange", "sourceId": "S0", "startMs": 2800, "endMs": 6200},  # ~30%
        {"type": "cutRange", "sourceId": "S0", "startMs": 7500, "endMs": 14300},  # ~50% more
    ]
    commands, dropped = validate_commands(raw, index)
    assert [c["type"] for c in commands] == ["setVibe", "cutRange"]
    assert dropped[0].index == 2 and "60%" in dropped[0].reason
    after, _ = apply_ai_commands(index.plan, commands)
    assert kept_speech_ratio(after) >= 0.6


def test_validate_drops_commands_that_break_the_plan(
    index: PlanIndex, monkeypatch: pytest.MonkeyPatch
) -> None:
    """Safety net: if applying a command ever yields an invalid EditPlan, it is dropped."""
    import app.ai.rules as rules

    real = rules.apply_ai_commands

    def corrupting(plan: dict[str, Any], commands: Any) -> Any:
        out, skipped = real(plan, commands)
        if any(c["type"] == "setTitle" for c in commands):
            out["captions"]["size"] = 999
        return out, skipped

    monkeypatch.setattr(rules, "apply_ai_commands", corrupting)
    commands, dropped = validate_commands(
        [{"type": "setVibe", "vibe": "story"}, {"type": "setTitle", "title": "Ok"}], index
    )
    assert commands == [{"type": "setVibe", "vibe": "story"}]
    assert [(d.index, d.reason) for d in dropped] == [(1, "makes the plan invalid")]


def test_describe_changes(index: PlanIndex) -> None:
    commands = director.merge(index, specialist_results(index), hook_option=0)
    changes = describe_changes(commands, index)
    assert "Cut 1 repeated take" in changes
    assert "Music: Epic Drums" in changes
    assert "Captions set to Beast" in changes
    assert "Added 2 zoom-ins" in changes  # zoom-2 kept: no Director drop here
    assert "Hook: “Your first 3 seconds decide everything”" in changes
