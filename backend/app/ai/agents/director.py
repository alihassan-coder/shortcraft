"""Director: reviews every proposal (LLM), then merges them into one conflict-free list of
commands (code). The code rules always run, so a weak or failed LLM review can't produce a
broken edit:

- no zoom that overlaps a cut, no highlight or emoji on a cut word,
- zooms don't overlap and are at least MIN_ZOOM_GAP_MS apart,
- caps on cuts, highlights, emojis and zooms (by video length / kept words).
"""

import math
from typing import Any

from pydantic import BaseModel

from app.ai.agents.base import (
    AgentResult,
    Proposal,
    call_structured,
    load_prompt,
    messages,
)
from app.ai.context import PlanIndex, active_cuts
from app.ai.models import AgentModels

NAME = "director"
AGENT_ORDER = ("cut", "caption", "zoom", "hook", "music")
MAX_CUTS = 12
MIN_ZOOM_GAP_MS = 3000
ZOOM_EVERY_MS = 5000
MAX_ZOOMS = 12
WORDS_PER_HIGHLIGHT = 4
WORDS_PER_EMOJI = 20


class DirectorOutput(BaseModel):
    """The Director's review of the proposals."""

    drop: list[str]
    hook_option: int
    rationale: str


def proposals_text(results: list[AgentResult]) -> str:
    lines = ["# PROPOSALS"]
    for result in _ordered(results):
        lines.append(f"## {result.agent}")
        if result.error:
            lines.append("(this specialist failed; nothing to review)")
            continue
        if result.rationale:
            lines.append(f"rationale: {result.rationale}")
        if not result.proposals:
            lines.append("(no proposals)")
        lines += [f"- {p.id}: {p.label}" for p in result.proposals]
    return "\n".join(lines)


def _ordered(results: list[AgentResult]) -> list[AgentResult]:
    rank = {name: i for i, name in enumerate(AGENT_ORDER)}
    return sorted(results, key=lambda r: (rank.get(r.agent, 99), r.agent))


async def review(models: AgentModels, context: str, results: list[AgentResult]) -> dict[str, Any]:
    task = load_prompt(NAME) + "\n\n" + proposals_text(results)
    return await call_structured(models, NAME, DirectorOutput, messages(context, task))


def _overlaps(start: float, end: float, ranges: list[tuple[float, float]]) -> bool:
    return any(start < e and end > s for s, e in ranges)


def _inside(mid: float, ranges: list[tuple[float, float]]) -> bool:
    return any(s <= mid <= e for s, e in ranges)


def merge(
    index: PlanIndex,
    results: list[AgentResult],
    *,
    drop: set[str] | frozenset[str] = frozenset(),
    hook_option: int = 0,
) -> list[dict[str, Any]]:
    """One command list from all proposals, conflicts resolved (deterministic)."""
    plan = index.plan
    by_agent = {r.agent: r for r in results}
    props: dict[str, list[Proposal]] = {}
    for result in _ordered(results):
        for p in result.proposals:
            if p.id not in drop:
                props.setdefault(p.kind, []).append(p)

    commands: list[dict[str, Any]] = []

    # Cuts first: everything else is checked against the final cut ranges.
    cut_ranges: dict[str, list[tuple[float, float]]] = {
        sid: [(c["startMs"], c["endMs"]) for c in active_cuts(plan, sid)]
        for sid in index.source_ids
    }
    new_cuts = sorted(props.get("cut", []), key=lambda p: (p.source_id or "", p.start_ms or 0))
    for p in new_cuts[:MAX_CUTS]:
        assert p.source_id is not None and p.start_ms is not None and p.end_ms is not None
        commands.append(p.command)
        cut_ranges[p.source_id].append((p.start_ms, p.end_ms))

    def word_cut(p: Proposal) -> bool:
        assert p.source_id is not None and p.start_ms is not None and p.end_ms is not None
        return _inside((p.start_ms + p.end_ms) / 2, cut_ranges[p.source_id])

    kept_words = sum(
        1
        for w in index.words
        if not w.filler and not _inside((w.start_ms + w.end_ms) / 2, cut_ranges[w.source_id])
    )

    caption = by_agent.get("caption")
    caption_ok = caption is not None and caption.error is None
    commands += [p.command for p in props.get("captions", [])]

    # Highlights replace the current set when the caption agent picked any.
    highlights = [p for p in props.get("highlight", []) if not word_cut(p)]
    highlights.sort(key=lambda p: index.by_id[p.word_id or ""].index)
    highlights = highlights[: max(1, math.ceil(kept_words / WORDS_PER_HIGHLIGHT))]
    chosen = [p.word_id for p in highlights]
    if caption_ok and chosen:
        current = plan["captions"]["highlights"]
        commands += [{"type": "toggleHighlight", "wordId": w} for w in current if w not in chosen]
        commands += [{"type": "toggleHighlight", "wordId": w} for w in chosen if w not in current]

    emojis = [p for p in props.get("emoji", []) if p.word_id in chosen]
    emojis = emojis[: max(1, kept_words // WORDS_PER_EMOJI)]
    if caption_ok:
        keep = {p.word_id for p in emojis}
        commands += [
            {"type": "setEmoji", "wordId": w, "emoji": None}
            for w in sorted(plan["captions"]["emojis"])
            if w not in keep
        ]
        commands += [p.command for p in emojis]

    # Zooms replace the current ones when the zoom agent placed any that survive.
    total_ms = sum(index.durations.values())
    max_zooms = min(MAX_ZOOMS, max(1, int(total_ms // ZOOM_EVERY_MS)))
    zooms: list[Proposal] = []
    last: dict[str, tuple[float, float]] = {}
    for p in sorted(props.get("zoom", []), key=lambda p: (p.source_id or "", p.start_ms or 0)):
        assert p.source_id is not None and p.start_ms is not None and p.end_ms is not None
        if _overlaps(p.start_ms, p.end_ms, cut_ranges[p.source_id]):
            continue
        prev = last.get(p.source_id)
        if prev and (p.start_ms < prev[1] or p.start_ms - prev[0] < MIN_ZOOM_GAP_MS):
            continue
        zooms.append(p)
        last[p.source_id] = (p.start_ms, p.end_ms)
        if len(zooms) == max_zooms:
            break
    if zooms:
        commands += [{"type": "removeZoom", "zoomId": z["id"]} for z in plan["zooms"]["items"]]
        commands += [p.command for p in zooms]

    for p in props.get("hook", []):
        options = p.command["hook"]["options"]
        pick = hook_option if 0 <= hook_option < len(options) else 0
        commands.append({"type": "setHook", "hook": {**p.command["hook"], "text": options[pick]}})
    commands += [p.command for p in props.get("music", [])]
    return commands
