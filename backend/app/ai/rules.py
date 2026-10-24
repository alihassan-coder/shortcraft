"""The `validate` step: AI output -> commands that are safe to apply.

1. Resolve references: `#12` / `12` -> the word's id, `S0` -> the source id.
2. Schema: each command must parse as an `AgentCommand` (others are dropped, with a reason).
3. Ids must exist (words, sources, cuts, zooms); presets and music tracks must be known.
4. Times are clamped to the source; empty ranges are dropped.
5. Exact duplicates are dropped (a duplicated toggle would undo itself).
6. At least MIN_SPEECH_KEPT of the speech must survive; cut commands are dropped from the
   end until it does.
7. The plan after all commands must still be a valid EditPlan; offending commands go.
"""

import json
from collections.abc import Iterable
from typing import Any

from pydantic import ValidationError

from app.ai.apply import apply_ai_commands, kept_speech_ratio
from app.ai.commands import (
    CAPTION_PRESET_IDS,
    MUSIC_TRACK_IDS,
    DroppedCommand,
    dump_command,
    parse_commands,
)
from app.ai.context import PlanIndex
from app.schemas.edit_plan import EditPlan

MIN_SPEECH_KEPT = 0.6
CUT_TYPES = frozenset({"cutRange", "toggleWordCut", "setCutRules", "toggleRestoreCut", "removeCut"})
WORD_COMMANDS = frozenset({"toggleHighlight", "setEmoji", "setWordText", "toggleWordCut"})
SOURCE_COMMANDS = frozenset({"cutRange", "toggleWordCut", "addZoom"})
TRACK_NAMES = {
    "summer-fun": "Summer Fun",
    "just-chill": "Just Chill",
    "forest-walk": "Forest Walk",
    "epic-drums": "Epic Drums",
    "a-new-life": "A New Life",
}


def _resolve(item: Any, index: PlanIndex) -> tuple[Any, str | None]:
    """Word/source references resolved in a copy of `item`, or a reason to drop it."""
    if not isinstance(item, dict):
        return item, None
    cmd = dict(item)
    kind = cmd.get("type")
    if kind in WORD_COMMANDS and "wordId" in cmd:
        word = index.word(cmd["wordId"])
        if word is None:
            return cmd, f"unknown word {cmd['wordId']!r}"
        cmd["wordId"] = word.id
        if kind == "toggleWordCut":
            cmd["sourceId"] = word.source_id
    if kind in SOURCE_COMMANDS and kind != "toggleWordCut":
        source = index.source(cmd.get("sourceId"))
        if source is None:
            return cmd, f"unknown source {cmd.get('sourceId')!r}"
        cmd["sourceId"] = source
    return cmd, None


def _clamp(value: float, low: float, high: float) -> float:
    return max(low, min(high, value))


def _check(cmd: dict[str, Any], index: PlanIndex) -> str | None:
    """Clamp times in place; return a reason when the command must be dropped."""
    kind = cmd["type"]
    if kind in ("toggleRestoreCut", "removeCut") and cmd["cutId"] not in index.cut_ids:
        return f"unknown cut {cmd['cutId']!r}"
    if kind in ("updateZoom", "removeZoom") and cmd["zoomId"] not in index.zoom_ids:
        return f"unknown zoom {cmd['zoomId']!r}"
    if kind == "setCaptions":
        preset = cmd["captions"].get("presetId")
        if preset is not None and preset not in CAPTION_PRESET_IDS:
            return f"unknown caption preset {preset!r}"
    if kind == "setMusic":
        track = cmd["music"].get("trackId")
        if track is not None and track not in MUSIC_TRACK_IDS:
            return f"unknown music track {track!r}"
    if kind == "cutRange":
        duration = index.durations[cmd["sourceId"]]
        cmd["startMs"] = _clamp(cmd["startMs"], 0, duration)
        cmd["endMs"] = _clamp(cmd["endMs"], 0, duration)
        if cmd["endMs"] <= cmd["startMs"]:
            return "empty cut range"
    if kind in ("addZoom", "updateZoom"):
        if kind == "addZoom":
            duration = index.durations[cmd["sourceId"]]
            cmd["atMs"] = _clamp(cmd["atMs"], 0, duration)
            patch = cmd.get("zoom") or {}
        else:
            zoom = next(z for z in index.plan["zooms"]["items"] if z["id"] == cmd["zoomId"])
            duration = index.durations.get(zoom["sourceId"], float("inf"))
            patch = cmd["patch"]
        for key in ("startMs", "endMs"):
            if key in patch:
                patch[key] = _clamp(patch[key], 0, duration)
        if "startMs" in patch and "endMs" in patch and patch["endMs"] <= patch["startMs"]:
            return "empty zoom range"
    if kind == "setHook" and "options" in cmd["hook"]:
        cmd["hook"]["options"] = [o for o in cmd["hook"]["options"] if o.strip()][:5]
    return None


def _plan_ok(plan: dict[str, Any]) -> bool:
    try:
        EditPlan.model_validate(plan)
    except ValidationError:
        return False
    return True


def validate_commands(
    raw: Iterable[Any], index: PlanIndex, *, min_speech: float = MIN_SPEECH_KEPT
) -> tuple[list[dict[str, Any]], list[DroppedCommand]]:
    """Commands (wire JSON) safe to apply to `index.plan`, plus what was dropped and why."""
    dropped: list[DroppedCommand] = []
    resolved: list[tuple[int, Any]] = []
    for i, item in enumerate(raw):
        cmd, reason = _resolve(item, index)
        if reason:
            dropped.append(
                DroppedCommand(i, cmd.get("type") if isinstance(cmd, dict) else None, reason)
            )
        else:
            resolved.append((i, cmd))

    parsed, bad = parse_commands(cmd for _, cmd in resolved)
    positions = [i for i, _ in resolved]
    dropped += [DroppedCommand(positions[d.index], d.type, d.reason) for d in bad]
    bad_at = {d.index for d in bad}
    origin = [positions[j] for j in range(len(resolved)) if j not in bad_at]

    out: list[tuple[int, dict[str, Any]]] = []
    seen: set[str] = set()
    for pos, model in zip(origin, parsed, strict=True):
        cmd = dump_command(model)
        reason = _check(cmd, index)
        key = json.dumps(cmd, sort_keys=True, ensure_ascii=False)
        if reason is None and key in seen:
            reason = "duplicate command"
        if reason:
            dropped.append(DroppedCommand(pos, cmd["type"], reason))
            continue
        seen.add(key)
        out.append((pos, cmd))

    # Speech rule: drop cut commands from the end until enough speech is kept.
    plan = index.plan
    floor = min(min_speech, kept_speech_ratio(plan))
    while True:
        applied, _ = apply_ai_commands(plan, [c for _, c in out])
        if kept_speech_ratio(applied) >= floor - 1e-9:
            break
        last_cut = next(
            (k for k in range(len(out) - 1, -1, -1) if out[k][1]["type"] in CUT_TYPES), None
        )
        if last_cut is None:
            break
        pos, cmd = out.pop(last_cut)
        dropped.append(
            DroppedCommand(pos, cmd["type"], f"would keep less than {min_speech:.0%} of the speech")
        )

    # The result must still be a valid plan: drop commands that break it, one at a time.
    if not _plan_ok(applied):
        kept: list[tuple[int, dict[str, Any]]] = []
        current = plan
        for pos, cmd in out:
            candidate, _ = apply_ai_commands(current, [cmd])
            if _plan_ok(candidate):
                kept.append((pos, cmd))
                current = candidate
            else:
                dropped.append(DroppedCommand(pos, cmd["type"], "makes the plan invalid"))
        out = kept

    dropped.sort(key=lambda d: d.index)
    return [c for _, c in out], dropped


def describe_changes(commands: list[dict[str, Any]], index: PlanIndex) -> list[str]:
    """Short "what changed" lines for the creator, from the commands themselves."""
    changes: list[str] = []
    count: dict[str, int] = {}
    for cmd in commands:
        count[cmd["type"]] = count.get(cmd["type"], 0) + 1

    def plural(n: int, word: str) -> str:
        return f"{n} {word}{'' if n == 1 else 's'}"

    for cmd in commands:
        kind = cmd["type"]
        match kind:
            case "setVibe":
                changes.append(f"Vibe set to {cmd['vibe'].title()}")
            case "setCaptions":
                c = cmd["captions"]
                if "presetId" in c:
                    changes.append(f"Captions set to {c['presetId'].replace('-', ' ').title()}")
                if c.get("showEmojis") is False:
                    changes.append("Emojis turned off")
                if c.get("showEmojis") is True:
                    changes.append("Emojis turned on")
                if "size" in c:
                    changes.append(f"Caption size {round(c['size'])}")
                if c.get("enabled") is False:
                    changes.append("Captions turned off")
            case "setMusic":
                m = cmd["music"]
                if "trackId" in m:
                    track = m["trackId"]
                    changes.append(
                        f"Music: {TRACK_NAMES.get(track, track)}" if track else "Removed the music"
                    )
                elif "volume" in m:
                    changes.append(f"Music volume {round(m['volume'] * 100)}%")
            case "setHook":
                h = cmd["hook"]
                if h.get("enabled") is False:
                    changes.append("Removed the hook title")
                elif h.get("text"):
                    changes.append(f"Hook: “{h['text']}”")
            case "setZoomsEnabled":
                changes.append("Zoom-ins turned " + ("on" if cmd["enabled"] else "off"))
            case "updateAllZooms":
                style = cmd["patch"].get("style")
                changes.append(f"Zoom-ins set to {style.title()}" if style else "Zoom-ins updated")
            case "setCutRules":
                for rule, on in cmd["rules"].items():
                    changes.append(f"{rule.title()} cuts turned {'on' if on else 'off'}")
            case "setTitle":
                changes.append(f"Title: {cmd['title']}")
            case "setCanvas" if "aspect" in cmd["canvas"]:
                changes.append(f"Canvas set to {cmd['canvas']['aspect']}")
            case "setVoice":
                changes.append("Voice enhance " + ("on" if cmd["voice"].get("enhance") else "off"))
            case "setProgressBar":
                changes.append("Progress bar updated")
    if n := count.get("cutRange"):
        notes = [c.get("note", "") for c in commands if c["type"] == "cutRange"]
        retakes = sum(1 for n_ in notes if "twice" in n_ or "take" in n_)
        changes.append(
            f"Cut {plural(n, 'repeated take')}" if retakes == n else f"Cut {plural(n, 'part')}"
        )
    if n := count.get("toggleWordCut"):
        changes.append(f"Toggled the cut on {plural(n, 'word')}")
    if count.get("removeCut") or count.get("toggleRestoreCut"):
        changes.append("Restored some cut parts")
    if n := count.get("toggleHighlight"):
        added = sum(
            1
            for c in commands
            if c["type"] == "toggleHighlight" and c["wordId"] not in index.highlights
        )
        changes.append(
            f"Highlighted {plural(added, 'key word')}" if added else "Updated highlighted words"
        )
    emojis = [c for c in commands if c["type"] == "setEmoji" and c.get("emoji")]
    if emojis:
        changes.append(f"Added {plural(len(emojis), 'emoji')}")
    if n := count.get("addZoom"):
        changes.append(f"Added {plural(n, 'zoom-in')}")
    elif n := count.get("removeZoom"):
        changes.append(f"Removed {plural(n, 'zoom-in')}")
    if count.get("updateZoom"):
        changes.append("Adjusted zoom-ins")
    if count.get("setWordText"):
        changes.append("Fixed caption text")
    return changes
