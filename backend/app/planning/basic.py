"""The first edit without AI (`plan` job, mode "basic").

`build_basic_plan` is a pure function: transcript words + ffmpeg silences in, an EditPlan v2
dict out (camelCase, exactly what the editor loads). It cuts silences, filler words and
obvious retakes, and adds default captions, a few zooms, a hook option and music by vibe.
The LLM agents (A3) later improve on this; if they fail, this edit is what the user gets.
"""

import copy
from collections.abc import Sequence
from dataclasses import dataclass
from typing import Any, Literal

from app.transcription.base import TranscriptWord, normalize_token

Vibe = Literal["energetic", "clean", "story"]
VIBES: tuple[Vibe, ...] = ("energetic", "clean", "story")
Range = tuple[int, int]

CAPTION_PRESET: dict[Vibe, str] = {"energetic": "bold-pop", "clean": "clean", "story": "story"}
MUSIC_TRACK: dict[Vibe, str] = {
    "energetic": "summer-fun",
    "clean": "just-chill",
    "story": "a-new-life",
}
ZOOM_LOOK: dict[Vibe, tuple[str, float]] = {
    "energetic": ("punch", 1.2),
    "clean": ("smooth", 1.1),
    "story": ("smooth", 1.12),
}

RETAKE_NOTE = "You said this line twice. Kept the second take."
STOPWORDS = frozenset(
    """a about above after again against all also am an and any are aren't as at be because
    been before being below between both but by can can't could couldn't did didn't do does
    doesn't doing don't down during each even every few for from further get gets getting got
    had hadn't has hasn't have haven't having he he'd he'll he's her here here's hers herself
    him himself his how how's i i'd i'll i'm i've if in into is isn't it it's its itself just
    let's like me more most much must my myself no nor not now of off on once only or other
    our ours ourselves out over own really right same she she'd she'll she's should shouldn't
    so some still such than that that's the their theirs them themselves then there there's
    these they they'd they'll they're they've thing things this those though through to too
    under until up very was wasn't we we'd we'll we're we've were weren't what what's when
    when's where where's which while who who's whom why why's will with won't would wouldn't
    yeah you you'd you'll you're you've your yours yourself yourselves gonna wanna gotta okay
    """.split()  # noqa: SIM905
)
SENTENCE_END = (".", "?", "!", "…")
ABANDONED_END = ("—", "–", "-", "...", "…")  # noqa: RUF001


@dataclass(frozen=True, slots=True)
class SourceMeta:
    id: str
    src: str  # storage key of the proxy (resolved to a URL by GET /plan/resolved)
    width: int
    height: int
    duration_ms: int
    title: str = "Untitled"
    poster: str | None = None


@dataclass(frozen=True, slots=True)
class BasicPlanSettings:
    vibe: Vibe = "energetic"
    min_pause_ms: int = 400
    cut_padding_ms: int = 120
    min_cut_ms: int = 100
    # Retakes: phrase of >= this many words, restarted within this many ms.
    retake_min_words: int = 3
    retake_window_ms: int = 4000
    retake_max_abandoned: int = 4
    # Captions / zooms / hook.
    highlight_every: int = 6
    highlight_min_len: int = 5
    zoom_min_gap_ms: int = 6000
    zoom_words: int = 4
    hook_max_words: int = 8
    hook_duration_ms: int = 2600


# --- ranges ------------------------------------------------------------------------------


def merge_ranges(ranges: Sequence[Range], *, gap: int = 0) -> list[Range]:
    """Sorted union; ranges closer than `gap` ms are joined."""
    merged: list[list[int]] = []
    for start, end in sorted((s, e) for s, e in ranges if e > s):
        if merged and start <= merged[-1][1] + gap:
            merged[-1][1] = max(merged[-1][1], end)
        else:
            merged.append([start, end])
    return [(s, e) for s, e in merged]


def subtract_ranges(ranges: Sequence[Range], holes: Sequence[Range]) -> list[Range]:
    """`ranges` minus every range in `holes` (both may be unsorted)."""
    holes = merge_ranges(holes)
    out: list[Range] = []
    for start, end in merge_ranges(ranges):
        cursor = start
        for h_start, h_end in holes:
            if h_end <= cursor or h_start >= end:
                continue
            if h_start > cursor:
                out.append((cursor, h_start))
            cursor = max(cursor, h_end)
            if cursor >= end:
                break
        if cursor < end:
            out.append((cursor, end))
    return out


def word_gaps(words: Sequence[TranscriptWord], duration_ms: int, min_pause_ms: int) -> list[Range]:
    """Pauses longer than `min_pause_ms`: before the first word, between words, after the last."""
    if not words:
        return []
    edges = [0, *(t for w in words for t in (w.start_ms, w.end_ms)), duration_ms]
    gaps = []
    for i in range(0, len(edges), 2):
        start, end = edges[i], edges[i + 1]
        if end - start > min_pause_ms:
            gaps.append((start, end))
    return gaps


def silence_cuts(
    words: Sequence[TranscriptWord],
    silences: Sequence[Range],
    duration_ms: int,
    *,
    min_pause_ms: int = 400,
    padding_ms: int = 120,
    min_cut_ms: int = 100,
) -> list[Range]:
    """Silent ranges to cut: ffmpeg silences + long word gaps, never overlapping a word, with
    `padding_ms` of air kept next to speech (none at the very start/end of the video)."""
    if not words:
        return []  # nothing to anchor on: cutting everything would leave an empty video
    clamped = [(max(0, s), min(duration_ms, e)) for s, e in silences]
    candidates = merge_ranges([*clamped, *word_gaps(words, duration_ms, min_pause_ms)])
    quiet = subtract_ranges(candidates, [(w.start_ms, w.end_ms) for w in words])
    cuts: list[Range] = []
    for start, end in quiet:
        s = start + padding_ms if start > 0 else 0
        e = end - padding_ms if end < duration_ms else duration_ms
        if e - s >= min_cut_ms:
            cuts.append((s, e))
    return cuts


# --- retakes -----------------------------------------------------------------------------


def detect_retakes(
    words: Sequence[TranscriptWord],
    *,
    min_words: int = 3,
    window_ms: int = 4000,
    max_abandoned: int = 4,
) -> list[tuple[int, int]]:
    """(first, restart) word indexes: words[first:restart] is an abandoned first attempt of
    the phrase that starts again at words[restart].

    Conservative on purpose. A retake needs a phrase of >= `min_words` words said again
    within `window_ms`, and the first attempt must look abandoned: it either goes off in a
    different direction before the restart, or ends with a dash / ellipsis. Plain repetition
    ("very very", "I love it, I love it") is never cut. Fillers are ignored when matching.
    """
    content = [i for i, w in enumerate(words) if not w.filler]
    tokens = [normalize_token(words[i].text) for i in content]
    found: list[tuple[int, int]] = []
    a = 0
    while a < len(content):
        hit: tuple[int, int] | None = None
        for b in range(a + 1, len(content)):
            if words[content[b]].start_ms - words[content[a]].start_ms > window_ms:
                break
            if not tokens[a] or tokens[b] != tokens[a]:
                continue
            if a > 0 and tokens[a - 1] == tokens[b - 1]:
                continue  # the tail of a longer match that starts earlier
            length = 0
            while (
                a + length < b
                and b + length < len(content)
                and tokens[a + length] == tokens[b + length]
            ):
                length += 1
            if length < min_words:
                continue
            abandoned = b - a - length
            last_text = words[content[b - 1]].text.rstrip()
            looks_cut_off = last_text.endswith(ABANDONED_END)
            if abandoned > max_abandoned:
                continue
            if abandoned > 0 or looks_cut_off:
                hit = (content[a], content[b])
                break
        if hit is None:
            a += 1
            continue
        found.append(hit)
        a = content.index(hit[1])
    return found


# --- captions, zooms, hook ---------------------------------------------------------------


def _inside(word: TranscriptWord, ranges: Sequence[Range]) -> bool:
    mid = (word.start_ms + word.end_ms) / 2
    return any(s <= mid < e for s, e in ranges)


def pick_highlights(
    words: Sequence[TranscriptWord],
    ids: Sequence[str],
    *,
    every: int = 6,
    min_len: int = 5,
    skip: Sequence[Range] = (),
) -> list[str]:
    """At most one highlight per `every` kept words: the longest content word of the group
    (length >= `min_len`, not a stopword), earliest on ties. Deterministic."""
    kept = [i for i, w in enumerate(words) if not w.filler and not _inside(w, skip)]
    picks: list[str] = []
    for start in range(0, len(kept), every):
        best: tuple[int, int] | None = None  # (-length, index)
        for i in kept[start : start + every]:
            token = normalize_token(words[i].text)
            if len(token) < min_len or token in STOPWORDS or not token.replace("'", "").isalpha():
                continue
            key = (-len(token), i)
            if best is None or key < best:
                best = key
        if best is not None:
            picks.append(ids[best[1]])
    return picks


def _ends_sentence(text: str) -> bool:
    return text.rstrip().rstrip("\"')]").endswith(SENTENCE_END)


def sentence_starts(
    words: Sequence[TranscriptWord], *, min_pause_ms: int, skip: Sequence[Range] = ()
) -> list[int]:
    """Indexes of words that start a sentence after a pause: the first word, and any word
    after a sentence end + a pause > `min_pause_ms`, or after a pause > 2x that."""
    kept = [i for i, w in enumerate(words) if not w.filler and not _inside(w, skip)]
    starts: list[int] = []
    prev: int | None = None
    for i in kept:
        if prev is None:
            starts.append(i)
        else:
            pause = words[i].start_ms - words[prev].end_ms
            if (pause > min_pause_ms and _ends_sentence(words[prev].text)) or (
                pause > 2 * min_pause_ms
            ):
                starts.append(i)
        prev = i
    return starts


HOOK_SKIP_LEADING = frozenset({"so", "and", "okay", "ok", "well", "alright", "right"})
_TRAILING_PUNCT = ",;:.—–-"  # noqa: RUF001


def first_sentence(
    words: Sequence[TranscriptWord], max_words: int, skip: Sequence[Range] = ()
) -> str:
    """Hook text: the first spoken sentence (fillers and retakes skipped), without a leading
    "So"/"And", at most `max_words` words. A longer sentence is cut at its last comma inside
    the limit when there is one."""
    out: list[str] = []
    for w in words:
        if w.filler or _inside(w, skip):
            continue
        if not out and normalize_token(w.text) in HOOK_SKIP_LEADING:
            continue
        out.append(w.text.strip())
        if _ends_sentence(w.text) or len(out) > max_words:
            break
    if not out:
        return ""
    if len(out) > max_words:  # too long: trim, at a comma when possible
        out = out[:max_words]
        commas = [i for i, t in enumerate(out[:-1]) if t.endswith((",", ";", ":"))]
        if commas:
            out = out[: commas[-1] + 1]
    text = " ".join(out).rstrip(_TRAILING_PUNCT)
    return text[:1].upper() + text[1:]


# --- the plan ----------------------------------------------------------------------------

DEFAULT_CLIP_LOOK: dict[str, Any] = {
    "speed": 1,
    "volume": 1,
    "muted": False,
    "frame": {
        "fit": "fill",
        "scale": 1,
        "x": 0,
        "y": 0,
        "rotate": 0,
        "flipH": False,
        "flipV": False,
    },
    "crop": {"left": 0, "top": 0, "right": 0, "bottom": 0},
    "color": {"preset": "none", "brightness": 0, "contrast": 0, "saturation": 0, "temperature": 0},
}


def build_basic_plan(
    source_meta: SourceMeta,
    words: Sequence[TranscriptWord],
    silences: Sequence[Range],
    settings: BasicPlanSettings | None = None,
) -> dict[str, Any]:
    """An EditPlan v2 (wire format, camelCase) for one source."""
    cfg = settings or BasicPlanSettings()
    vibe = cfg.vibe
    sid = source_meta.id
    duration = source_meta.duration_ms
    words = sorted(
        (w for w in words if w.end_ms > 0 and w.start_ms < duration),
        key=lambda w: (w.start_ms, w.end_ms),
    )
    words = [
        TranscriptWord(w.text, w.start_ms, min(w.end_ms, duration), w.confidence, w.filler)
        for w in words
    ]
    ids = [f"w{i}" for i in range(len(words))]

    plan_words: list[dict[str, Any]] = []
    for wid, w in zip(ids, words, strict=True):
        item: dict[str, Any] = {"id": wid, "text": w.text, "startMs": w.start_ms, "endMs": w.end_ms}
        if w.filler:
            item["filler"] = True
        plan_words.append(item)

    cuts: list[dict[str, Any]] = []
    silent = silence_cuts(
        words,
        silences,
        duration,
        min_pause_ms=cfg.min_pause_ms,
        padding_ms=cfg.cut_padding_ms,
        min_cut_ms=cfg.min_cut_ms,
    )
    cuts += [
        {"id": f"silence-{n}", "sourceId": sid, "startMs": s, "endMs": e, "reason": "silence"}
        for n, (s, e) in enumerate(silent)
    ]
    cuts += [
        {
            "id": f"filler-{wid}",
            "sourceId": sid,
            "startMs": w.start_ms,
            "endMs": w.end_ms,
            "reason": "filler",
        }
        for wid, w in zip(ids, words, strict=True)
        if w.filler
    ]
    retakes = detect_retakes(
        words,
        min_words=cfg.retake_min_words,
        window_ms=cfg.retake_window_ms,
        max_abandoned=cfg.retake_max_abandoned,
    )
    retake_ranges = [(words[a].start_ms, words[b].start_ms) for a, b in retakes]
    cuts += [
        {
            "id": f"retake-{n}",
            "sourceId": sid,
            "startMs": s,
            "endMs": e,
            "reason": "retake",
            "note": RETAKE_NOTE,
        }
        for n, (s, e) in enumerate(retake_ranges)
    ]
    cuts.sort(key=lambda c: (c["startMs"], c["endMs"], c["id"]))

    highlights = pick_highlights(
        words, ids, every=cfg.highlight_every, min_len=cfg.highlight_min_len, skip=retake_ranges
    )

    style, scale = ZOOM_LOOK[vibe]
    zooms: list[dict[str, Any]] = []
    last_zoom: int | None = None
    for i in sentence_starts(words, min_pause_ms=cfg.min_pause_ms, skip=retake_ranges):
        start = words[i].start_ms
        if last_zoom is not None and start - last_zoom < cfg.zoom_min_gap_ms:
            continue
        j = i
        while (
            j + 1 < len(words)
            and j - i + 1 < cfg.zoom_words
            and not _ends_sentence(words[j].text)
            and words[j + 1].start_ms - words[j].end_ms <= cfg.min_pause_ms
        ):
            j += 1
        zooms.append(
            {
                "id": f"zoom-{len(zooms)}",
                "sourceId": sid,
                "startMs": start,
                "endMs": max(words[j].end_ms, start + 1),
                "scale": scale,
                "style": style,
                "focusX": 0.5,
                "focusY": 0.33,
            }
        )
        last_zoom = start

    hook_text = first_sentence(words, cfg.hook_max_words, skip=retake_ranges)
    source: dict[str, Any] = {
        "id": sid,
        "src": source_meta.src,
        "width": source_meta.width,
        "height": source_meta.height,
        "durationMs": duration,
        "words": plan_words,
    }
    if source_meta.poster:
        source["poster"] = source_meta.poster

    return {
        "version": 2,
        "id": f"plan-{sid}",
        "title": source_meta.title,
        "vibe": vibe,
        "canvas": {
            "aspect": "9:16",
            "width": 1080,
            "height": 1920,
            "fps": 30,
            "background": {"type": "blur", "color": "#000000"},
        },
        "sources": [source],
        "clips": [{"id": "clip-1", "sourceId": sid, "inMs": 0, "outMs": duration, **_look()}],
        "cuts": {"items": cuts, "silence": True, "filler": True, "retake": True, "restored": []},
        "captions": {
            "enabled": True,
            "presetId": CAPTION_PRESET[vibe],
            "size": 108,
            "positionY": 0.68,
            "wordsPerLine": 2,
            "showEmojis": False,
            "highlights": highlights,
            "emojis": {},
            "edits": {},
        },
        "zooms": {"enabled": True, "items": zooms},
        "overlays": {
            "texts": [],
            "images": [],
            "progressBar": {"enabled": False, "position": "bottom", "color": "#ffffff"},
        },
        "music": {
            "trackId": MUSIC_TRACK[vibe],
            "volume": 0.45,
            "ducking": True,
            "duckTo": 0.25,
            "fadeInMs": 600,
            "fadeOutMs": 1200,
        },
        "hook": {
            "enabled": bool(hook_text),
            "text": hook_text,
            "options": [hook_text] if hook_text else [],
            "durationMs": cfg.hook_duration_ms,
        },
        "voice": {"enhance": False},
    }


def _look() -> dict[str, Any]:
    return copy.deepcopy(DEFAULT_CLIP_LOOK)
