"""Apply AI edit commands to a plan in Python (the plan job saves the result).

A port of `applyEdit` in frontend/lib/edit-plan/commands.ts for the commands the agents
emit. Same rules: a command that does nothing leaves the plan unchanged, `Object.assign`
patches only overwrite the fields they carry. New ids are deterministic here (`manual-ai-0`,
`zoom-ai-0`) instead of time-based, so the same commands always give the same plan.
Commands outside the subset are skipped and reported.
"""

import copy
from collections.abc import Iterable
from typing import Any

from pydantic import BaseModel

from app.ai.commands import dump_command
from app.ai.context import is_cut_active

VIBE_DEFAULTS: dict[str, tuple[str, str]] = {
    "energetic": ("bold-pop", "summer-fun"),
    "clean": ("clean", "just-chill"),
    "story": ("story", "a-new-life"),
}
ZOOM_LENGTH_MS = 1400
MIN_ZOOM_MS = 200


def _new_id(plan: dict[str, Any], prefix: str) -> str:
    taken = {c["id"] for c in plan["cuts"]["items"]} | {z["id"] for z in plan["zooms"]["items"]}
    n = 0
    while f"{prefix}-ai{n}" in taken:
        n += 1
    return f"{prefix}-ai{n}"


def _source(plan: dict[str, Any], source_id: str) -> dict[str, Any] | None:
    return next((s for s in plan["sources"] if s["id"] == source_id), None)


def _cut_for_word(plan: dict[str, Any], source_id: str, word: dict[str, Any]) -> dict | None:
    mid = (word["startMs"] + word["endMs"]) / 2
    return next(
        (
            c
            for c in plan["cuts"]["items"]
            if c["sourceId"] == source_id and c["startMs"] <= mid <= c["endMs"]
        ),
        None,
    )


def _mutate(p: dict[str, Any], cmd: dict[str, Any]) -> bool | None:
    """Apply in place. True = changed, False = no-op, None = not supported here."""
    kind = cmd["type"]
    match kind:
        case "setTitle":
            p["title"] = cmd["title"]
        case "setVibe":
            preset, track = VIBE_DEFAULTS[cmd["vibe"]]
            p["vibe"] = cmd["vibe"]
            p["captions"]["presetId"] = preset
            if p["music"].get("trackId"):
                p["music"]["trackId"] = track
        case "setCutRules":
            p["cuts"].update(cmd["rules"])
        case "toggleRestoreCut":
            cut = next((c for c in p["cuts"]["items"] if c["id"] == cmd["cutId"]), None)
            if cut is None or cut["reason"] == "manual":
                return False
            restored = p["cuts"]["restored"]
            p["cuts"]["restored"] = (
                [x for x in restored if x != cut["id"]]
                if cut["id"] in restored
                else [*restored, cut["id"]]
            )
        case "removeCut":
            before = len(p["cuts"]["items"])
            p["cuts"]["items"] = [c for c in p["cuts"]["items"] if c["id"] != cmd["cutId"]]
            return len(p["cuts"]["items"]) != before
        case "cutRange":
            if cmd["endMs"] - cmd["startMs"] <= 0:
                return False
            cut = {
                "id": _new_id(p, "manual"),
                "sourceId": cmd["sourceId"],
                "startMs": cmd["startMs"],
                "endMs": cmd["endMs"],
                "reason": "manual",
            }
            if cmd.get("note"):
                cut["note"] = cmd["note"]
            p["cuts"]["items"].append(cut)
        case "toggleWordCut":
            source = _source(p, cmd["sourceId"])
            word = next(
                (w for w in (source or {}).get("words", []) if w["id"] == cmd["wordId"]), None
            )
            if word is None:
                return False
            cut = _cut_for_word(p, cmd["sourceId"], word)

            def manual() -> None:
                p["cuts"]["items"].append(
                    {
                        "id": _new_id(p, "manual"),
                        "sourceId": cmd["sourceId"],
                        "startMs": word["startMs"],
                        "endMs": word["endMs"],
                        "reason": "manual",
                    }
                )

            if cut is None:
                manual()
            elif cut["reason"] == "manual":
                p["cuts"]["items"] = [c for c in p["cuts"]["items"] if c["id"] != cut["id"]]
            elif cut["id"] in p["cuts"]["restored"] or not p["cuts"].get(cut["reason"]):
                manual()
            else:
                p["cuts"]["restored"].append(cut["id"])
        case "setWordText":
            words = [w for s in p["sources"] for w in s["words"]]
            original = next((w["text"] for w in words if w["id"] == cmd["wordId"]), None)
            if original is None:
                return False
            text = cmd["text"].strip()
            if not text or text == original:
                p["captions"]["edits"].pop(cmd["wordId"], None)
            else:
                p["captions"]["edits"][cmd["wordId"]] = text
        case "setCaptions":
            p["captions"].update(cmd["captions"])
        case "toggleHighlight":
            h = p["captions"]["highlights"]
            wid = cmd["wordId"]
            p["captions"]["highlights"] = [x for x in h if x != wid] if wid in h else [*h, wid]
        case "setEmoji":
            if cmd.get("emoji"):
                p["captions"]["emojis"][cmd["wordId"]] = cmd["emoji"]
            else:
                p["captions"]["emojis"].pop(cmd["wordId"], None)
        case "setZoomsEnabled":
            p["zooms"]["enabled"] = cmd["enabled"]
        case "addZoom":
            source = _source(p, cmd["sourceId"])
            if source is None:
                return False
            start = max(0, min(cmd["atMs"], source["durationMs"] - ZOOM_LENGTH_MS))
            zoom = {
                "id": _new_id(p, "zoom"),
                "sourceId": cmd["sourceId"],
                "startMs": start,
                "endMs": start + ZOOM_LENGTH_MS,
                "scale": 1.2,
                "style": "punch",
                "focusX": 0.5,
                "focusY": 0.33,
                **(cmd.get("zoom") or {}),
            }
            p["zooms"]["items"].append(zoom)
            p["zooms"]["items"].sort(key=lambda z: z["startMs"])
            p["zooms"]["enabled"] = True
        case "updateZoom":
            zoom = next((z for z in p["zooms"]["items"] if z["id"] == cmd["zoomId"]), None)
            if zoom is None:
                return False
            zoom.update(cmd["patch"])
            if zoom["endMs"] - zoom["startMs"] < MIN_ZOOM_MS:
                zoom["endMs"] = zoom["startMs"] + MIN_ZOOM_MS
            p["zooms"]["items"].sort(key=lambda z: z["startMs"])
        case "updateAllZooms":
            for zoom in p["zooms"]["items"]:
                zoom.update(cmd["patch"])
            return bool(p["zooms"]["items"])
        case "removeZoom":
            before = len(p["zooms"]["items"])
            p["zooms"]["items"] = [z for z in p["zooms"]["items"] if z["id"] != cmd["zoomId"]]
            return len(p["zooms"]["items"]) != before
        case "setMusic":
            p["music"].update(cmd["music"])
        case "setVoice":
            p["voice"].update(cmd["voice"])
        case "setHook":
            p["hook"].update(cmd["hook"])
        case _:
            return None
    return True


def apply_ai_commands(
    plan: dict[str, Any], commands: Iterable[BaseModel | dict[str, Any]]
) -> tuple[dict[str, Any], list[str]]:
    """A new plan with the commands applied in order, plus the types that were skipped
    because they are not supported on the backend. The input plan is not modified."""
    p = copy.deepcopy(plan)
    skipped: list[str] = []
    for command in commands:
        cmd = dump_command(command) if isinstance(command, BaseModel) else command
        if _mutate(p, copy.deepcopy(cmd)) is None:
            skipped.append(cmd["type"])
    return p, skipped


def kept_speech_ratio(plan: dict[str, Any]) -> float:
    """Share of spoken (non-filler) word time that no active cut removes. 1.0 without words."""
    total = kept = 0.0
    for source in plan["sources"]:
        cuts = [
            c
            for c in plan["cuts"]["items"]
            if c["sourceId"] == source["id"] and is_cut_active(plan, c)
        ]
        for w in source["words"]:
            if w.get("filler"):
                continue
            length = max(0.0, w["endMs"] - w["startMs"])
            total += length
            mid = (w["startMs"] + w["endMs"]) / 2
            if not any(c["startMs"] <= mid <= c["endMs"] for c in cuts):
                kept += length
    return 1.0 if total == 0 else kept / total
