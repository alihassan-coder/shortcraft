"use client";

import { toast } from "sonner";
import { newId } from "@/lib/edit-plan/commands";
import type { Clip, EditPlan, TextItem } from "@/lib/edit-plan/schema";
import { presetById, presetTextStyle } from "@/lib/edit-plan/text-styles";
import { formatTime, resolveTimeline } from "@/lib/edit-plan/timeline";
import { revealPanel } from "./layout";
import { runPrompt } from "./mock-director";
import { playerControls } from "./player";
import { dispatch, selectedId, undo, usePlanStore, useUiStore } from "./store";

// Editor actions shared by the menu bar, command palette, context menus and
// keyboard shortcuts. Each one turns a user intent into edit commands and
// tells the user what happened.

const plan = () => usePlanStore.getState().plan;
const ui = () => useUiStore.getState();

/* ---------- Shortcut labels ---------- */

export const isMac = () => typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform);

/** "mod+shift+z" → "⌘⇧Z" on a Mac, "Ctrl+Shift+Z" elsewhere. */
export function keyLabel(combo: string) {
  const mac = isMac();
  return combo
    .split("+")
    .map((k) => {
      switch (k) {
        case "mod":
          return mac ? "⌘" : "Ctrl";
        case "shift":
          return mac ? "⇧" : "Shift";
        case "alt":
          return mac ? "⌥" : "Alt";
        case "delete":
          return mac ? "⌫" : "Del";
        default:
          return k.length === 1 ? k.toUpperCase() : k;
      }
    })
    .join(mac ? "" : "+");
}

/* ---------- Helpers ---------- */

/** The clip on screen at the playhead (edited timeline). */
export function clipAtPlayhead(p: EditPlan = plan()): Clip | undefined {
  const at = resolveTimeline(p).toSource(ui().currentMs);
  return p.clips.find((c) => c.id === at?.clipId) ?? undefined;
}

/** Clip the user means: the selected one, else the one at the playhead, else the first. */
export function targetClip(p: EditPlan = plan()): Clip {
  const id = selectedId("clip");
  return p.clips.find((c) => c.id === id) ?? clipAtPlayhead(p) ?? p.clips[0];
}

/** Dispatch and report whether the plan changed. */
function apply(cmd: Parameters<typeof dispatch>[0]) {
  const before = plan();
  dispatch(cmd);
  return plan() !== before;
}

const undoAction = { label: "Undo", onClick: () => undo() };

function needEdited() {
  if (!ui().original) return true;
  toast("Switch to Edited first", { description: "Clips are edited on the edited timeline." });
  return false;
}

/* ---------- Clip actions ---------- */

export function splitAtPlayhead() {
  if (!needEdited()) return;
  const at = ui().currentMs;
  if (!apply({ type: "splitAt", outMs: at })) {
    toast.error("Can't split here", { description: "Move the playhead away from the start or end of a clip." });
    return;
  }
  const clip = clipAtPlayhead();
  if (clip) ui().select({ kind: "clip", id: clip.id });
  toast(`Split at ${formatTime(at, true)}`, { action: undoAction });
}

export function duplicateClip(clipId = targetClip().id) {
  if (!needEdited()) return;
  if (apply({ type: "duplicateClip", clipId })) toast("Clip duplicated", { action: undoAction });
}

export function deleteClip(clipId: string) {
  if (!needEdited()) return;
  if (!apply({ type: "deleteClips", clipIds: [clipId] })) {
    toast.error("Can't delete the only clip", { description: "A video needs at least one clip." });
    return;
  }
  ui().select(null);
  toast("Clip deleted", { action: undoAction });
}

export function selectClipAtPlayhead() {
  const clip = clipAtPlayhead();
  if (clip) ui().select({ kind: "clip", id: clip.id });
}

export function copyStyle(clipId = targetClip().id) {
  const clip = plan().clips.find((c) => c.id === clipId);
  if (!clip) return;
  ui().setStyleClipboard({ frame: structuredClone(clip.frame), color: structuredClone(clip.color) });
  toast("Style copied", { description: "Right-click another clip and choose Paste style." });
}

export function pasteStyle(clipId = targetClip().id) {
  const look = ui().styleClipboard;
  if (!look) return;
  if (apply({ type: "updateClip", clipId, patch: { frame: look.frame, color: look.color } }))
    toast("Style pasted", { action: undoAction });
}

export function applyColorPreset(preset: Clip["color"]["preset"], all = false) {
  const p = plan();
  const ids = all ? p.clips.map((c) => c.id) : [targetClip(p).id];
  dispatch(ids.map((clipId) => ({ type: "updateClip" as const, clipId, patch: { color: { preset } } })));
}

/* ---------- Selection ---------- */

/** Delete key / Edit → Delete: whatever is selected. */
export function deleteSelection() {
  const sel = ui().selection;
  if (!sel) return;
  switch (sel.kind) {
    case "word": {
      const source = plan().sources[0];
      dispatch({ type: "toggleWordCut", sourceId: source.id, wordId: sel.id });
      return;
    }
    case "text":
      if (apply({ type: "removeItems", itemIds: [sel.id] })) {
        ui().select(null);
        toast("Text deleted", { action: undoAction });
      }
      return;
    case "zoom":
      if (apply({ type: "removeZoom", zoomId: sel.id })) {
        ui().select(null);
        toast("Zoom deleted", { action: undoAction });
      }
      return;
    case "clip":
      return deleteClip(sel.id);
  }
}

/* ---------- Text ---------- */

/** All text items, in track order. */
export const textItems = (p: EditPlan = plan()): TextItem[] =>
  p.tracks.flatMap((t) => t.items.filter((i): i is TextItem => i.kind === "text"));

export function addTextAtPlayhead(presetId = "clean", text = "Your text") {
  const id = newId("text");
  const style = presetTextStyle(presetById(presetId));
  if (apply({ type: "addItem", trackKind: "text", atMs: ui().currentMs, item: { id, text, presetId, style } })) {
    ui().select({ kind: "text", id });
    revealPanel("inspector");
  }
}

export function duplicateText(textId: string) {
  const id = newId("text");
  if (apply({ type: "duplicateItems", itemIds: [textId], newIds: [id] })) ui().select({ kind: "text", id });
}

export function deleteText(textId: string) {
  if (!apply({ type: "removeItems", itemIds: [textId] })) return;
  if (ui().selection?.id === textId) ui().select(null);
  toast("Text deleted", { action: undoAction });
}

/* ---------- Project ---------- */

export function focusTitle() {
  const el = document.getElementById("project-title") as HTMLInputElement | null;
  el?.focus();
  el?.select();
}

export function comingSoon(what: string) {
  toast(`${what} is coming soon`);
}

export function askAgents(text: string) {
  const ask = text.trim();
  if (!ask) return;
  const res = runPrompt(ask);
  if (res.ok) toast(res.changes[0] ?? "Done", { description: res.changes.slice(1).join(" · ") || undefined, action: undoAction });
  else toast.error("The agents can't do that one yet", { description: "Try “make it calmer” or “bigger captions”." });
}

export function toggleOriginal() {
  ui().setOriginal(!ui().original);
  playerControls.seekOutputMs(0);
}
