"""What the agents read: a compact, deterministic text view of a plan + transcript.

The same plan always gives the same text (stable ordering, no timestamps or random ids), so
the long prefix shared by every agent call is cacheable by OpenAI's automatic prompt caching.
Words are numbered `[i]` across all sources; agents refer to words by that number (`#i`).
"""

from collections.abc import Iterable
from dataclasses import dataclass, field
from typing import Any

SENTENCE_END = (".", "?", "!", "…")
PAUSE_SHOWN_MS = 400


# --- plan helpers (ports of frontend/lib/edit-plan/timeline.ts) --------------------------


def is_cut_active(plan: dict[str, Any], cut: dict[str, Any]) -> bool:
    cuts = plan["cuts"]
    reason = cut["reason"]
    return reason == "manual" or (bool(cuts.get(reason)) and cut["id"] not in cuts["restored"])


def active_cuts(plan: dict[str, Any], source_id: str | None = None) -> list[dict[str, Any]]:
    items = [
        c
        for c in plan["cuts"]["items"]
        if (source_id is None or c["sourceId"] == source_id) and is_cut_active(plan, c)
    ]
    return sorted(items, key=lambda c: c["startMs"])


def is_word_cut(plan: dict[str, Any], source_id: str, word: dict[str, Any]) -> bool:
    mid = (word["startMs"] + word["endMs"]) / 2
    return any(c["startMs"] <= mid <= c["endMs"] for c in active_cuts(plan, source_id))


def _ends_sentence(text: str) -> bool:
    return text.rstrip().rstrip("\"')]").endswith(SENTENCE_END)


# --- index -------------------------------------------------------------------------------


@dataclass(frozen=True, slots=True)
class IndexedWord:
    index: int
    id: str
    source_id: str
    text: str
    start_ms: float
    end_ms: float
    filler: bool
    cut: bool
    sentence_end: bool


@dataclass(slots=True)
class PlanIndex:
    """Lookups over one plan: words by number and id, sources by alias (S0, S1...)."""

    plan: dict[str, Any]
    words: list[IndexedWord] = field(default_factory=list)
    by_id: dict[str, IndexedWord] = field(default_factory=dict)
    source_ids: list[str] = field(default_factory=list)
    durations: dict[str, float] = field(default_factory=dict)

    @classmethod
    def build(cls, plan: dict[str, Any]) -> PlanIndex:
        index = cls(plan=plan)
        for source in plan["sources"]:
            sid = source["id"]
            index.source_ids.append(sid)
            index.durations[sid] = source["durationMs"]
            for w in sorted(source["words"], key=lambda w: (w["startMs"], w["endMs"])):
                word = IndexedWord(
                    index=len(index.words),
                    id=w["id"],
                    source_id=sid,
                    text=w["text"],
                    start_ms=w["startMs"],
                    end_ms=w["endMs"],
                    filler=bool(w.get("filler")),
                    cut=is_word_cut(plan, sid, w),
                    sentence_end=_ends_sentence(w["text"]),
                )
                index.words.append(word)
                index.by_id[word.id] = word
        return index

    def alias(self, source_id: str) -> str:
        return f"S{self.source_ids.index(source_id)}"

    def word(self, ref: Any) -> IndexedWord | None:
        """A word from its id, `#12`, `12` or the int 12."""
        if isinstance(ref, bool):
            return None
        if isinstance(ref, int):
            return self.words[ref] if 0 <= ref < len(self.words) else None
        if not isinstance(ref, str):
            return None
        if ref in self.by_id:
            return self.by_id[ref]
        raw = ref.strip().removeprefix("#").strip("[]")
        if raw.isdigit():
            return self.word(int(raw))
        return None

    def source(self, ref: Any) -> str | None:
        """A source id from its id or alias (`S0`); the only source when there is one."""
        if isinstance(ref, str):
            if ref in self.durations:
                return ref
            raw = ref.strip().upper()
            if raw.startswith("S") and raw[1:].isdigit() and int(raw[1:]) < len(self.source_ids):
                return self.source_ids[int(raw[1:])]
        return self.source_ids[0] if len(self.source_ids) == 1 else None

    @property
    def cut_ids(self) -> set[str]:
        return {c["id"] for c in self.plan["cuts"]["items"]}

    @property
    def zoom_ids(self) -> set[str]:
        return {z["id"] for z in self.plan["zooms"]["items"]}

    @property
    def highlights(self) -> set[str]:
        return set(self.plan["captions"]["highlights"])

    def kept_words(self) -> list[IndexedWord]:
        return [w for w in self.words if not w.cut and not w.filler]


# --- text --------------------------------------------------------------------------------


def _ms(value: float) -> str:
    return str(round(value))


def _word_ref(index: PlanIndex, word_id: str) -> str:
    w = index.by_id.get(word_id)
    return f"#{w.index} {w.text!r}" if w else f"{word_id} (unknown word)"


def _flag(value: Any) -> str:
    return "on" if value else "off"


def summarize_plan(index: PlanIndex) -> str:
    """The plan without the transcript: settings, cuts, captions, zooms, music, hook."""
    p = index.plan
    lines: list[str] = ["# PLAN"]
    lines.append(f"title: {p.get('title', '')!r}")
    lines.append(f"vibe: {p['vibe']}")
    c = p["canvas"]
    lines.append(f"canvas: {c['aspect']} {c['width']}x{c['height']} {c['fps']}fps")
    for sid in index.source_ids:
        n = sum(1 for w in index.words if w.source_id == sid)
        lines.append(
            f"source {index.alias(sid)}: id={sid} duration={_ms(index.durations[sid])}ms words={n}"
        )

    cuts = p["cuts"]
    lines.append("")
    lines.append(
        f"## CUTS (rules: silence={_flag(cuts['silence'])} filler={_flag(cuts['filler'])} "
        f"retake={_flag(cuts['retake'])})"
    )
    items = sorted(cuts["items"], key=lambda x: (x["sourceId"], x["startMs"], x["id"]))
    if not items:
        lines.append("(none)")
    for cut in items:
        state = "active" if is_cut_active(p, cut) else "inactive"
        if cut["id"] in cuts["restored"]:
            state = "restored"
        note = f' note="{cut["note"]}"' if cut.get("note") else ""
        lines.append(
            f"- {cut['id']} {index.alias(cut['sourceId'])} {_ms(cut['startMs'])}-"
            f"{_ms(cut['endMs'])}ms {cut['reason']} {state}{note}"
        )

    cap = p["captions"]
    lines.append("")
    lines.append(
        f"## CAPTIONS {_flag(cap['enabled'])}: preset={cap['presetId']} size={cap['size']} "
        f"positionY={cap['positionY']} wordsPerLine={cap['wordsPerLine']} "
        f"emojis={_flag(cap['showEmojis'])}"
    )
    highlights = sorted(
        cap["highlights"],
        key=lambda i: (index.by_id[i].index, i) if i in index.by_id else (10**9, i),
    )
    lines.append("highlights: " + (", ".join(_word_ref(index, h) for h in highlights) or "(none)"))
    emojis = sorted(cap["emojis"].items(), key=lambda kv: kv[0])
    lines.append(
        "emojis: " + (", ".join(f"{_word_ref(index, k)} {v}" for k, v in emojis) or "(none)")
    )
    if cap["edits"]:
        edits = sorted(cap["edits"].items())
        lines.append(
            "text edits: " + ", ".join(f"{_word_ref(index, k)} -> {v!r}" for k, v in edits)
        )

    zooms = p["zooms"]
    lines.append("")
    lines.append(f"## ZOOMS {_flag(zooms['enabled'])}")
    zitems = sorted(zooms["items"], key=lambda z: (z["sourceId"], z["startMs"], z["id"]))
    if not zitems:
        lines.append("(none)")
    for z in zitems:
        lines.append(
            f"- {z['id']} {index.alias(z['sourceId'])} {_ms(z['startMs'])}-{_ms(z['endMs'])}ms "
            f"{z['style']} x{z['scale']}"
        )

    m = p["music"]
    lines.append("")
    lines.append(
        f"## MUSIC track={m['trackId'] or 'none'} volume={m['volume']} "
        f"ducking={_flag(m['ducking'])} duckTo={m['duckTo']}"
    )
    h = p["hook"]
    lines.append(
        f"## HOOK {_flag(h['enabled'])}: text={h['text']!r} options={h['options']!r} "
        f"durationMs={_ms(h['durationMs'])}"
    )
    lines.append(f"## VOICE enhance={_flag(p['voice']['enhance'])}")
    return "\n".join(lines)


def transcript_text(index: PlanIndex, *, pause_ms: int = PAUSE_SHOWN_MS) -> str:
    """One word per line: `[i] text (start-end ms)` + flags. Blank line between sentences,
    `-- pause N ms --` for gaps longer than `pause_ms`."""
    lines = [
        "# TRANSCRIPT",
        "Format: [i] word (startMs-endMs) flags. Flags: F=filler, X=already cut, "
        "H=highlighted, E=emoji. A blank line ends a sentence.",
    ]
    highlights = index.highlights
    emojis = index.plan["captions"]["emojis"]
    prev: IndexedWord | None = None
    for w in index.words:
        if prev is None or prev.source_id != w.source_id:
            lines.append("")
            lines.append(f"## {index.alias(w.source_id)}")
        elif w.start_ms - prev.end_ms > pause_ms:
            lines.append(f"-- pause {_ms(w.start_ms - prev.end_ms)} ms --")
        flags = "".join(
            f
            for f, on in (
                ("F", w.filler),
                ("X", w.cut),
                ("H", w.id in highlights),
                ("E", w.id in emojis),
            )
            if on
        )
        lines.append(
            f"[{w.index}] {w.text} ({_ms(w.start_ms)}-{_ms(w.end_ms)})"
            + (f" {flags}" if flags else "")
        )
        if w.sentence_end:
            lines.append("")
        prev = w
    return "\n".join(lines).rstrip() + "\n"


def build_context(plan: dict[str, Any] | PlanIndex, *, include_transcript: bool = True) -> str:
    index = plan if isinstance(plan, PlanIndex) else PlanIndex.build(plan)
    parts = [summarize_plan(index)]
    if include_transcript:
        parts.append(transcript_text(index))
    return "\n\n".join(parts)


def words_text(words: Iterable[IndexedWord]) -> str:
    return " ".join(w.text for w in words)
