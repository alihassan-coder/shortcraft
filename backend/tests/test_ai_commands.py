"""AI command models mirror the TS `EditCommand` shapes; the context builder is stable."""

import copy
import json
import os
import random
from pathlib import Path
from typing import Any

import pytest

from app.ai.agents.edit import reply_schema
from app.ai.commands import (
    COMMAND_TYPES,
    command_list_json_schema,
    dump_commands,
    openai_friendly_schema,
    parse_commands,
)
from app.ai.context import PlanIndex, build_context
from tests.ai_fakes import fixture_plan

pytestmark = pytest.mark.unit

CONTEXT_GOLDEN = Path(__file__).with_name("fixtures") / "ai_context_golden.txt"

# Every command shape the mock Director (frontend/lib/editor/mock-director.ts) sends, plus
# the rest of the subset, exactly as TypeScript writes them.
TS_COMMANDS: list[dict[str, Any]] = [
    {"type": "setVibe", "vibe": "energetic"},
    {"type": "setCutRules", "rules": {"silence": True, "filler": True}},
    {"type": "setCaptions", "captions": {"showEmojis": True}},
    {"type": "setZoomsEnabled", "enabled": True},
    {"type": "updateAllZooms", "patch": {"style": "punch", "scale": 1.22}},
    {"type": "setMusic", "music": {"trackId": "summer-fun", "volume": 0.55}},
    {"type": "setMusic", "music": {"trackId": None}},
    {"type": "setCaptions", "captions": {"size": 122}},
    {"type": "setHook", "hook": {"enabled": False}},
    {"type": "setCanvas", "canvas": {"aspect": "1:1"}},
    {"type": "cutRange", "sourceId": "src-1", "startMs": 100, "endMs": 900, "note": "On request"},
    {"type": "toggleWordCut", "sourceId": "src-1", "wordId": "w3"},
    {"type": "toggleRestoreCut", "cutId": "silence-0"},
    {"type": "removeCut", "cutId": "manual-1"},
    {"type": "setWordText", "wordId": "w3", "text": "Hi"},
    {"type": "toggleHighlight", "wordId": "w3"},
    {"type": "setEmoji", "wordId": "w3", "emoji": "\U0001f525"},
    {"type": "setEmoji", "wordId": "w3", "emoji": None},
    {"type": "addZoom", "sourceId": "src-1", "atMs": 1200},
    {"type": "addZoom", "sourceId": "src-1", "atMs": 1200, "zoom": {"scale": 1.3, "focusY": 0.4}},
    {"type": "updateZoom", "zoomId": "zoom-0", "patch": {"endMs": 2000, "style": "smooth"}},
    {"type": "removeZoom", "zoomId": "zoom-0"},
    {"type": "setProgressBar", "bar": {"enabled": True, "color": "#FF5B1F"}},
    {"type": "setVoice", "voice": {"enhance": True}},
    {"type": "setTitle", "title": "New"},
]


def test_ts_shaped_commands_round_trip_unchanged() -> None:
    good, dropped = parse_commands(copy.deepcopy(TS_COMMANDS))
    assert dropped == []
    assert dump_commands(good) == TS_COMMANDS  # same keys, camelCase, nothing added


@pytest.mark.parametrize(
    ("command", "reason"),
    [
        ({"type": "deleteClips", "clipIds": ["c1"]}, "unsupported command type"),
        ({"type": "setVibe", "vibe": "spicy"}, "vibe"),
        ({"type": "setCaptions", "captions": {"size": 400}}, "size"),
        ({"type": "setCaptions", "captions": {"wordsPerLine": 4}}, "wordsPerLine"),
        ({"type": "setCaptions", "captions": {"bogus": 1}}, "Extra inputs"),
        ({"type": "setCaptions", "captions": {"showEmojis": "false"}}, "showEmojis"),
        ({"type": "cutRange", "sourceId": "s", "startMs": -5, "endMs": 10}, "startMs"),
        ({"type": "cutRange", "source_id": "s", "startMs": 0, "endMs": 10}, "sourceId"),
        ({"type": "setEmoji", "wordId": "w1"}, "emoji"),  # TS: required (string | null)
        ({"type": "addZoom", "sourceId": "s", "atMs": 0, "zoom": {"scale": 3}}, "scale"),
        ({"type": "setMusic", "music": {"volume": 2}}, "volume"),
        ({"type": "setProgressBar", "bar": {"color": "red"}}, "color"),
        ({"noType": True}, "type"),
        ("setVibe", ""),
    ],
)
def test_invalid_commands_are_dropped_with_a_reason(command: Any, reason: str) -> None:
    good, dropped = parse_commands([{"type": "setVibe", "vibe": "clean"}, command])
    assert len(good) == 1
    assert len(dropped) == 1 and dropped[0].index == 1
    assert reason in dropped[0].reason


def test_json_schema_export_covers_every_command() -> None:
    schema = command_list_json_schema()
    assert schema["type"] == "array"
    text = json.dumps(schema)
    for kind in COMMAND_TYPES:
        assert f'"{kind}"' in text
    assert '"wordId"' in text and '"word_id"' not in text
    friendly = json.dumps(openai_friendly_schema(schema))
    assert "oneOf" not in friendly and "discriminator" not in friendly
    edit = reply_schema()
    assert edit["title"] == "EditReply" and set(edit["required"]) >= {"ok", "commands"}


# --- context -------------------------------------------------------------------------------


def test_context_snapshot() -> None:
    """Set UPDATE_GOLDEN=1 to rewrite after an intended change."""
    text = build_context(fixture_plan())
    if os.environ.get("UPDATE_GOLDEN") == "1" or not CONTEXT_GOLDEN.exists():
        CONTEXT_GOLDEN.write_text(text, encoding="utf-8")
    assert text == CONTEXT_GOLDEN.read_text(encoding="utf-8")


def test_context_is_deterministic_and_order_independent() -> None:
    plan = fixture_plan()
    shuffled = copy.deepcopy(plan)
    rng = random.Random(7)
    rng.shuffle(shuffled["cuts"]["items"])
    rng.shuffle(shuffled["zooms"]["items"])
    rng.shuffle(shuffled["captions"]["highlights"])
    rng.shuffle(shuffled["sources"][0]["words"])
    assert build_context(shuffled) == build_context(plan)


def test_context_marks_fillers_cuts_highlights_and_pauses() -> None:
    plan = fixture_plan()
    plan["captions"]["emojis"] = {"w24": "\U0001f4a8"}
    text = build_context(plan)
    assert "[1] um, (500-800) FX" in text  # filler, cut
    assert "[3] your (1390-1550) X" in text  # inside the retake cut
    assert "[10] videos (3110-3410) H" in text
    assert "[24] scroll (8270-8570) E" in text
    assert "-- pause 900 ms --" in text
    assert "seconds. (5590-6110) H\n\n" in text  # blank line after a sentence
    assert "source S0: id=src-1 duration=20000ms words=55" in text
    assert "- retake-0 S0 1250-2810ms retake active" in text


def test_index_resolves_references() -> None:
    index = PlanIndex.build(fixture_plan())
    assert index.word("#12").id == "w12"  # type: ignore[union-attr]
    assert index.word(12).id == "w12"  # type: ignore[union-attr]
    assert index.word("12").id == "w12"  # type: ignore[union-attr]
    assert index.word("w12").index == 12  # type: ignore[union-attr]
    assert index.word("#999") is None and index.word(True) is None
    assert index.source("S0") == "src-1" == index.source("src-1")
    assert index.source("unknown") == "src-1"  # the only source
