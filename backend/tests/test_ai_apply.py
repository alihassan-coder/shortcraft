"""`apply_ai_commands` follows `applyEdit` in frontend/lib/edit-plan/commands.ts."""

import copy
from typing import Any

import pytest

from app.ai.apply import apply_ai_commands, kept_speech_ratio
from app.schemas.edit_plan import EditPlan

pytestmark = pytest.mark.unit


def apply(plan: dict[str, Any], *commands: dict[str, Any]) -> dict[str, Any]:
    out, skipped = apply_ai_commands(plan, commands)
    assert skipped == []
    EditPlan.model_validate(out)
    return out


def test_input_plan_is_not_modified(plan: dict[str, Any]) -> None:
    before = copy.deepcopy(plan)
    apply(plan, {"type": "setVibe", "vibe": "clean"}, {"type": "toggleHighlight", "wordId": "w2"})
    assert plan == before


def test_set_vibe_switches_preset_and_music_only_when_music_is_on(plan: dict[str, Any]) -> None:
    out = apply(plan, {"type": "setVibe", "vibe": "story"})
    assert (out["vibe"], out["captions"]["presetId"]) == ("story", "story")
    assert out["music"]["trackId"] is None  # TS: `if (p.music.trackId)`
    plan["music"]["trackId"] = "summer-fun"
    out = apply(plan, {"type": "setVibe", "vibe": "clean"})
    assert out["music"]["trackId"] == "just-chill"


def test_toggle_highlight_and_emoji(plan: dict[str, Any]) -> None:
    out = apply(plan, {"type": "toggleHighlight", "wordId": "w1"})
    assert out["captions"]["highlights"] == []  # was highlighted: removed
    out = apply(out, {"type": "toggleHighlight", "wordId": "w2"})
    assert out["captions"]["highlights"] == ["w2"]
    out = apply(out, {"type": "setEmoji", "wordId": "w2", "emoji": "\U0001f525"})
    assert out["captions"]["emojis"] == {"w1": "\U0001f44b", "w2": "\U0001f525"}
    out = apply(out, {"type": "setEmoji", "wordId": "w1", "emoji": None})
    assert out["captions"]["emojis"] == {"w2": "\U0001f525"}


def test_cut_range_adds_a_manual_cut_and_ignores_empty_ranges(plan: dict[str, Any]) -> None:
    out = apply(
        plan,
        {"type": "cutRange", "sourceId": "src_1", "startMs": 100, "endMs": 300, "note": "Asked"},
        {"type": "cutRange", "sourceId": "src_1", "startMs": 500, "endMs": 500},
        {"type": "cutRange", "sourceId": "src_1", "startMs": 800, "endMs": 900},
    )
    manual = [c for c in out["cuts"]["items"] if c["reason"] == "manual"]
    assert manual == [
        {
            "id": "manual-ai0",
            "sourceId": "src_1",
            "startMs": 100,
            "endMs": 300,
            "reason": "manual",
            "note": "Asked",
        },
        {"id": "manual-ai1", "sourceId": "src_1", "startMs": 800, "endMs": 900, "reason": "manual"},
    ]


def test_add_zoom_defaults_clamp_and_patch(plan: dict[str, Any]) -> None:
    out = apply(plan, {"type": "addZoom", "sourceId": "src_1", "atMs": 29500})
    zoom = next(z for z in out["zooms"]["items"] if z["id"] == "zoom-ai0")
    # TS: length 1400, start clamped to durationMs - 1400, punch 1.2, focus 0.5/0.33
    assert zoom == {
        "id": "zoom-ai0",
        "sourceId": "src_1",
        "startMs": 28600,
        "endMs": 30000,
        "scale": 1.2,
        "style": "punch",
        "focusX": 0.5,
        "focusY": 0.33,
    }
    plan["zooms"]["enabled"] = False
    out = apply(
        plan,
        {
            "type": "addZoom",
            "sourceId": "src_1",
            "atMs": 500,
            "zoom": {"startMs": 400, "endMs": 900, "style": "smooth"},
        },
    )
    assert out["zooms"]["enabled"] is True  # adding a zoom turns zooms on
    assert [z["id"] for z in out["zooms"]["items"]] == ["z1", "zoom-ai0"]  # sorted by start
    added = out["zooms"]["items"][1]
    assert (added["startMs"], added["endMs"], added["style"]) == (400, 900, "smooth")
    # Unknown source: no-op.
    same, _ = apply_ai_commands(plan, [{"type": "addZoom", "sourceId": "nope", "atMs": 0}])
    assert same["zooms"] == plan["zooms"]


def test_update_zoom_keeps_a_minimum_length(plan: dict[str, Any]) -> None:
    out = apply(plan, {"type": "updateZoom", "zoomId": "z1", "patch": {"endMs": 50}})
    zoom = out["zooms"]["items"][0]
    assert (zoom["startMs"], zoom["endMs"]) == (0, 200)
    out = apply(plan, {"type": "updateAllZooms", "patch": {"style": "smooth", "scale": 1.1}})
    assert (out["zooms"]["items"][0]["style"], out["zooms"]["items"][0]["scale"]) == ("smooth", 1.1)


def test_set_hook_music_captions_merge_fields(plan: dict[str, Any]) -> None:
    out = apply(
        plan,
        {"type": "setHook", "hook": {"text": "Stop", "options": ["Stop", "Go"]}},
        {"type": "setMusic", "music": {"trackId": "epic-drums", "volume": 0.6}},
        {"type": "setCaptions", "captions": {"presetId": "clean", "showEmojis": False}},
    )
    assert out["hook"] == {**plan["hook"], "text": "Stop", "options": ["Stop", "Go"]}
    assert out["music"] == {**plan["music"], "trackId": "epic-drums", "volume": 0.6}
    assert out["captions"]["presetId"] == "clean" and out["captions"]["size"] == 72


def test_restore_and_word_cut_follow_ts_rules(plan: dict[str, Any]) -> None:
    out = apply(plan, {"type": "toggleRestoreCut", "cutId": "cut_1"})
    assert out["cuts"]["restored"] == ["cut_1"]
    out = apply(out, {"type": "toggleRestoreCut", "cutId": "cut_1"})
    assert out["cuts"]["restored"] == []
    # w2 sits in the active filler cut -> toggleWordCut restores it.
    out = apply(plan, {"type": "toggleWordCut", "sourceId": "src_1", "wordId": "w2"})
    assert out["cuts"]["restored"] == ["cut_1"]
    # w1 has no cut -> a manual cut over the word; toggling again removes it.
    out = apply(plan, {"type": "toggleWordCut", "sourceId": "src_1", "wordId": "w1"})
    manual = [c for c in out["cuts"]["items"] if c["reason"] == "manual"]
    assert [(c["startMs"], c["endMs"]) for c in manual] == [(0, 400)]
    out = apply(out, {"type": "toggleWordCut", "sourceId": "src_1", "wordId": "w1"})
    assert all(c["reason"] != "manual" for c in out["cuts"]["items"])


def test_set_word_text_and_unsupported_commands(plan: dict[str, Any]) -> None:
    out = apply(plan, {"type": "setWordText", "wordId": "w1", "text": " Hi "})
    assert out["captions"]["edits"] == {"w1": "Hi"}
    out = apply(out, {"type": "setWordText", "wordId": "w1", "text": "Hello"})
    assert out["captions"]["edits"] == {}
    same, skipped = apply_ai_commands(plan, [{"type": "setCanvas", "canvas": {"aspect": "1:1"}}])
    assert skipped == ["setCanvas"] and same == plan


def test_kept_speech_ratio(plan: dict[str, Any]) -> None:
    assert kept_speech_ratio(plan) == 1.0  # the only cut is the filler
    out = apply(plan, {"type": "cutRange", "sourceId": "src_1", "startMs": 0, "endMs": 400})
    assert kept_speech_ratio(out) == 0.0
