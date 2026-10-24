"""A2: the non-AI first edit (pure functions + golden snapshot)."""

import itertools
import json
import os
from pathlib import Path

import pytest

from app.planning import (
    BasicPlanSettings,
    SourceMeta,
    build_basic_plan,
    detect_retakes,
    merge_ranges,
    pick_highlights,
    silence_cuts,
)
from app.planning.basic import RETAKE_NOTE, sentence_starts, subtract_ranges, word_gaps
from app.schemas.edit_plan import EditPlan
from app.transcription import TranscriptWord, is_filler

pytestmark = pytest.mark.unit

GOLDEN = Path(__file__).with_name("fixtures") / "basic_plan_golden.json"


def say(
    *tokens: str | tuple[str, int], start: int = 300, word_ms: int = 250
) -> list[TranscriptWord]:
    """Words from tokens; ("text", pause_after_ms) adds a pause. Fillers marked by text."""
    words: list[TranscriptWord] = []
    t = start
    for token in tokens:
        text, pause = token if isinstance(token, tuple) else (token, 0)
        words.append(TranscriptWord(text, t, t + word_ms, 0.99, is_filler(text)))
        t += word_ms + pause
    return words


# --- ranges / silences ----------------------------------------------------------------------


def test_merge_and_subtract_ranges() -> None:
    assert merge_ranges([(500, 900), (0, 100), (80, 200), (900, 950), (5, 5)]) == [
        (0, 200),
        (500, 950),
    ]
    assert merge_ranges([(0, 100), (150, 200)], gap=60) == [(0, 200)]
    assert subtract_ranges([(0, 1000)], [(100, 200), (150, 300), (900, 1200)]) == [
        (0, 100),
        (300, 900),
    ]
    assert subtract_ranges([(0, 100)], [(0, 100)]) == []


def test_word_gaps_include_leading_and_trailing_air() -> None:
    words = [TranscriptWord("a", 600, 800), TranscriptWord("b", 900, 1000)]
    assert word_gaps(words, 2000, 400) == [(0, 600), (1000, 2000)]
    assert word_gaps([], 2000, 400) == []


def test_silence_cuts_padding_and_merge() -> None:
    words = [
        TranscriptWord("one", 500, 900),
        TranscriptWord("two", 2000, 2400),
        TranscriptWord("three", 2600, 3000),
    ]
    # ffmpeg saw 950-1900 and a tiny 2420-2580 gap; the word gap 900-2000 joins the first.
    cuts = silence_cuts(words, [(950, 1900), (2420, 2580)], 4000, min_pause_ms=400, padding_ms=120)
    # leading air cut from 0 (no padding at the video start), padding kept before "one";
    # 900-2000 minus padding on both sides; 2400-2600 is too short once padded; trailing air
    # cut to the very end.
    assert cuts == [(0, 380), (1020, 1880), (3120, 4000)]


def test_silence_cuts_never_cover_words() -> None:
    words = say("quiet", "words")  # 300-550, 550-800
    cuts = silence_cuts(words, [(0, 2000)], 2000, padding_ms=0)
    assert cuts == [(0, 300), (800, 2000)]


def test_silence_cuts_without_words_cut_nothing() -> None:
    assert silence_cuts([], [(0, 5000)], 5000) == []


# --- retakes -------------------------------------------------------------------------------


def test_retake_abandoned_first_attempt() -> None:
    words = say("so", "if", "your", "videos", "are", ("not", 300), "if", "your", "videos",
                "aren't", "getting", "views.")  # fmt: skip
    assert detect_retakes(words) == [(1, 6)]


def test_retake_cut_off_with_a_dash() -> None:
    words = say("we", "need", "to", ("go\N{EM DASH}", 300), "we", "need", "to", "go", "now.")
    assert detect_retakes(words) == [(0, 4)]


def test_retake_ignores_fillers_between_takes() -> None:
    words = say("the", "best", "part", "is", ("um,", 200), "the", "best", "part", "is", "free.")
    assert detect_retakes(words) == []  # identical takes, nothing abandoned: kept
    words = say("the", "best", "thing", "uh", "the", "best", "thing", "about", "it.")
    assert detect_retakes(words) == []  # same, the filler is not an "abandoned" word


@pytest.mark.parametrize(
    "tokens",
    [
        ("this", "is", "very", "very", "good."),  # emphasis, 1 word
        ("I", "love", "it,", "I", "love", "it."),  # deliberate refrain, nothing abandoned
        ("no", "no", "no", "no."),
        ("go", "team", "go", "team", "go."),
        ("one", "two", "three", "four."),
    ],
)
def test_no_false_retakes(tokens: tuple[str, ...]) -> None:
    assert detect_retakes(say(*tokens)) == []


def test_retake_outside_the_time_window_is_ignored() -> None:
    words = say("if", "your", "videos", "are", ("not", 5000), "if", "your", "videos", "aren't")
    assert detect_retakes(words) == []


def test_retake_with_too_much_in_between_is_ignored() -> None:
    words = say("if", "your", "videos", "a", "b", "c", "d", "e", "if", "your", "videos")
    assert detect_retakes(words) == []


# --- captions / zooms --------------------------------------------------------------------------


def test_highlights_are_deterministic_and_sparse() -> None:
    words = say("people", "decide", "to", "scroll", "super", "fast.", "start", "with", "your",
                "strongest", "line,", "add", "big", "captions", "um")  # fmt: skip
    ids = [f"w{i}" for i in range(len(words))]
    first = pick_highlights(words, ids)
    assert first == pick_highlights(words, ids)
    # Groups of 6 kept words: the longest content word wins, earliest on ties.
    assert first == ["w0", "w9", "w13"]
    assert len(first) <= -(-sum(1 for w in words if not w.filler) // 6)
    # Words inside a skipped range (a retake cut) are never highlighted.
    assert "w9" not in pick_highlights(words, ids, skip=[(words[9].start_ms, words[10].end_ms)])


def test_highlights_skip_stopwords_and_short_words() -> None:
    words = say("about", "these", "there", "cat", "dog", "it's")
    assert pick_highlights(words, [f"w{i}" for i in range(6)]) == []


def test_sentence_starts_after_pauses() -> None:
    words = say(("Hello.", 600), "This", ("works", 900), "and", ("this.", 100), "Next")
    # 0: first word; 1: after "Hello." + 600 ms; 3: after a 900 ms pause (> 2x 400).
    # "Next" follows a sentence end but only a 100 ms pause.
    assert sentence_starts(words, min_pause_ms=400) == [0, 1, 3]


# --- the whole plan ---------------------------------------------------------------------------

SCRIPT: list[str | tuple[str, int]] = [
    "So", ("um,", 450),
    "if", "your", "videos", "are", "not", ("getting\N{EM DASH}", 300),
    "if", "your", "videos", "aren't", "getting", ("views,", 160),
    "it's", "probably", "the", "first", "three", ("seconds.", 900),
    ("Uh,", 200),
    "people", "decide", "to", "scroll", "super", ("fast.", 350),
    "So", "here's", "the", ("trick:", 260),
    "start", "with", "your", "strongest", ("line,", 120),
    "add", "big", ("captions,", 100),
    "and", "cut", "every", ("pause.", 700),
    "That's", ("it.", 180), "Try", "it", "today.",
]  # fmt: skip
META = SourceMeta(
    id="11111111-2222-3333-4444-555555555555",
    src="projects/aaaaaaaa-0000-0000-0000-000000000000/sources/11111111-2222-3333-4444-555555555555/proxy-720p.mp4",
    width=720,
    height=1280,
    duration_ms=16_000,
    title="Morning tip",
)
SILENCES = [(0, 280), (5_800, 6_750), (15_100, 16_000)]


def _golden_plan() -> dict:
    words = say(*SCRIPT, start=350, word_ms=240)
    return build_basic_plan(META, words, SILENCES, BasicPlanSettings(vibe="energetic"))


def test_basic_plan_validates_and_has_every_part() -> None:
    plan = _golden_plan()
    EditPlan.model_validate(plan)
    reasons = [c["reason"] for c in plan["cuts"]["items"]]
    assert reasons.count("filler") == 2
    assert reasons.count("retake") == 1
    assert reasons.count("silence") >= 3
    retake = next(c for c in plan["cuts"]["items"] if c["reason"] == "retake")
    assert retake["note"] == RETAKE_NOTE
    words = plan["sources"][0]["words"]
    assert (retake["startMs"], retake["endMs"]) == (words[2]["startMs"], words[8]["startMs"])
    assert plan["captions"]["presetId"] == "bold-pop"
    assert plan["captions"]["showEmojis"] is False and plan["captions"]["emojis"] == {}
    assert 0 < len(plan["captions"]["highlights"]) <= len(words) // 6 + 1
    assert plan["music"]["trackId"] == "summer-fun"
    assert plan["hook"]["enabled"] is True
    assert len(plan["hook"]["text"].split()) <= 8
    starts = [z["startMs"] for z in plan["zooms"]["items"]]
    assert all(b - a >= 6000 for a, b in itertools.pairwise(starts))
    assert {z["style"] for z in plan["zooms"]["items"]} == {"punch"}
    assert plan["clips"][0]["outMs"] == META.duration_ms
    # No silence cut overlaps a word.
    for cut in plan["cuts"]["items"]:
        if cut["reason"] == "silence":
            assert all(cut["endMs"] <= w["startMs"] or cut["startMs"] >= w["endMs"] for w in words)


@pytest.mark.parametrize(
    ("vibe", "preset", "track", "style"),
    [
        ("energetic", "bold-pop", "summer-fun", "punch"),
        ("clean", "clean", "just-chill", "smooth"),
        ("story", "story", "a-new-life", "smooth"),
    ],
)
def test_vibe_defaults(vibe: str, preset: str, track: str, style: str) -> None:
    words = say(*SCRIPT, start=350, word_ms=240)
    plan = build_basic_plan(META, words, SILENCES, BasicPlanSettings(vibe=vibe))  # type: ignore[arg-type]
    EditPlan.model_validate(plan)
    assert plan["vibe"] == vibe
    assert plan["captions"]["presetId"] == preset
    assert plan["music"]["trackId"] == track
    assert {z["style"] for z in plan["zooms"]["items"]} == {style}


def test_plan_without_words() -> None:
    plan = build_basic_plan(META, [], [(0, 16_000)])
    EditPlan.model_validate(plan)
    assert plan["cuts"]["items"] == []
    assert plan["hook"] == {"enabled": False, "text": "", "options": [], "durationMs": 2600}
    assert plan["captions"]["highlights"] == []
    assert plan["zooms"]["items"] == []


def test_golden_snapshot() -> None:
    """The basic plan for a fixed word list. Set UPDATE_GOLDEN=1 to rewrite after an intended
    change, and review the diff."""
    plan = _golden_plan()
    if os.environ.get("UPDATE_GOLDEN") == "1" or not GOLDEN.exists():
        GOLDEN.write_text(json.dumps(plan, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    assert plan == json.loads(GOLDEN.read_text(encoding="utf-8"))


def test_hook_text_rules() -> None:
    from app.planning.basic import first_sentence

    assert first_sentence(say("So", "um,", "this", "is", "it."), 8) == "This is it"
    long = say("Here", "is", "the", "thing,", "nobody", "watches", "past", "second", "three.")
    assert first_sentence(long, 8) == "Here is the thing"  # trimmed at the comma
    words = say("one", "two", "three", "four", "five", "six", "seven", "eight", "nine")
    assert first_sentence(words, 8) == "One two three four five six seven eight"
    assert first_sentence(say("hello,", "world"), 8) == "Hello, world"
    assert first_sentence([], 8) == ""
