"use client";

import { toast } from "sonner";
import { newId, type EditCommand, type ItemPatch } from "@/lib/edit-plan/commands";
import type { Clip, EditPlan, Item, TextItem, Track } from "@/lib/edit-plan/schema";
import { presetById, presetTextStyle } from "@/lib/edit-plan/text-styles";
import { formatTime, resolveTimeline } from "@/lib/edit-plan/timeline";
import { revealPanel } from "./layout";
import { runPrompt } from "./mock-director";
import { playerControls } from "./player";
import { dispatch, selectedId, undo, usePlanStore, useUiStore, type Selected } from "./store";
import { rippleMoves, useTimelineView } from "./timeline-view";

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

/** The track and item for an item id. */
export function findItem(itemId: string, p: EditPlan = plan()): { track: Track; item: Item } | null {
  for (const track of p.tracks) {
    const item = track.items.find((i) => i.id === itemId);
    if (item) return { track, item };
  }
  return null;
}

/** Selection entry for a track item (text items open the text inspector). */
export const itemSelection = (item: Item): Selected => ({ kind: item.kind === "text" ? "text" : "item", id: item.id });

const isItemSel = (s: Selected) => s.kind === "text" || s.kind === "item";

/** Delete key / Edit → Delete: whatever is selected. `ripple` closes the gaps left by deleted track items. */
export function deleteSelection({ ripple = false }: { ripple?: boolean } = {}) {
  const { selection, selected } = ui();
  if (!selection) return;
  const list = selected.length ? selected : [selection];
  if (list.length === 1 && selection.kind === "word") {
    dispatch({ type: "toggleWordCut", sourceId: plan().sources[0].id, wordId: selection.id });
    return;
  }
  if (!needEdited() && list.some((s) => s.kind === "clip")) return;

  const p = plan();
  const itemIds = list.filter(isItemSel).map((s) => s.id);
  const clipIds = list.filter((s) => s.kind === "clip").map((s) => s.id);
  const zoomIds = list.filter((s) => s.kind === "zoom").map((s) => s.id);
  const cmds: EditCommand[] = [];
  if (itemIds.length) {
    cmds.push({ type: "removeItems", itemIds });
    if (ripple)
      for (const track of p.tracks)
        if (!track.locked)
          for (const m of rippleMoves(track.items, itemIds)) cmds.push({ type: "moveItem", itemId: m.itemId, startMs: m.startMs });
  }
  const allClips = clipIds.length >= p.clips.length;
  if (clipIds.length && !allClips) cmds.push({ type: "deleteClips", clipIds });
  for (const zoomId of zoomIds) cmds.push({ type: "removeZoom", zoomId });

  if (allClips && clipIds.length && !itemIds.length && !zoomIds.length) {
    toast.error(p.clips.length === 1 ? "Can't delete the only clip" : "Can't delete every clip", {
      description: "A video needs at least one clip.",
    });
    return;
  }
  if (!cmds.length || !apply(cmds)) return;
  ui().select(null);
  const n = itemIds.length + (allClips ? 0 : clipIds.length) + zoomIds.length;
  const what =
    n > 1 ? `${n} items` : clipIds.length && !allClips ? "Clip" : zoomIds.length ? "Zoom" : list[0].kind === "text" ? "Text" : "Item";
  toast(`${what} deleted${ripple && itemIds.length ? " (gap closed)" : ""}`, { action: undoAction });
}

/** Ctrl+D: duplicate the selected clips and track items (or the clip at the playhead). */
export function duplicateSelection() {
  const { selected } = ui();
  const itemSels = selected.filter(isItemSel);
  const clipIds = selected.filter((s) => s.kind === "clip").map((s) => s.id);
  if (!itemSels.length && !clipIds.length) return duplicateClip();
  const newIds = itemSels.map((s) => newId(findItem(s.id)?.item.kind ?? "item"));
  const cmds: EditCommand[] = [
    ...clipIds.map((clipId) => ({ type: "duplicateClip" as const, clipId })),
    ...(itemSels.length ? [{ type: "duplicateItems" as const, itemIds: itemSels.map((s) => s.id), newIds }] : []),
  ];
  if (!apply(cmds)) return;
  const copies = newIds.map((id) => findItem(id)).filter((x) => !!x);
  if (copies.length) ui().setSelected(copies.map((c) => itemSelection(c.item)));
  toast(selected.length > 1 ? `${selected.length} items duplicated` : "Duplicated", { action: undoAction });
}

/** Ctrl+A: every clip and every item on unlocked, visible tracks. */
export function selectAll() {
  const p = plan();
  const items = p.tracks.filter((t) => !t.locked && !t.hidden).flatMap((t) => t.items.map(itemSelection));
  ui().setSelected([...items, ...p.clips.map((c) => ({ kind: "clip" as const, id: c.id }))]);
}

/** Ctrl+C: copy the selected track items (pasted at the playhead with the same spacing). */
export function copySelection() {
  const hits = ui()
    .selected.filter(isItemSel)
    .map((s) => findItem(s.id))
    .filter((x) => !!x);
  if (!hits.length) return false;
  const first = Math.min(...hits.map((h) => h.item.startMs));
  useTimelineView.getState().setClipboard(
    hits.map(({ track, item }) => ({ item: structuredClone(item), trackId: track.id, offsetMs: item.startMs - first })),
  );
  toast(hits.length > 1 ? `${hits.length} items copied` : "Copied", { description: `Paste with ${keyLabel("mod+V")} at the playhead.` });
  return true;
}

/** Ctrl+V: paste copied items at the playhead. */
export function pasteAtPlayhead() {
  const clip = useTimelineView.getState().clipboard;
  if (!clip?.length) return false;
  const p = plan();
  const at = ui().currentMs;
  const ids: string[] = [];
  const cmds: EditCommand[] = clip.map(({ item, trackId, offsetMs }) => {
    const { id: _id, kind, startMs, endMs, ...rest } = item;
    void _id;
    const id = newId(kind);
    ids.push(id);
    const track = p.tracks.find((t) => t.id === trackId && !t.locked);
    return {
      type: "addItem",
      trackKind: kind,
      trackId: track?.id,
      atMs: at + offsetMs,
      item: { ...(rest as ItemPatch), id, startMs, endMs },
    };
  });
  if (!apply(cmds)) return false;
  ui().setSelected(ids.map((id) => findItem(id)).filter((x) => !!x).map((h) => itemSelection(h.item)));
  toast(ids.length > 1 ? `${ids.length} items pasted` : "Pasted", { action: undoAction });
  return true;
}

/** Split one track item at an output time into two items (same look, same track). */
export function splitItemCommands(itemId: string, atMs: number, p: EditPlan = plan()): { cmds: EditCommand[]; newId: string } | null {
  const hit = findItem(itemId, p);
  if (!hit || hit.track.locked) return null;
  const { item } = hit;
  if (atMs - item.startMs < 100 || item.endMs - atMs < 100) return null;
  const copyId = newId(item.kind);
  const cmds: EditCommand[] = [{ type: "duplicateItems", itemIds: [itemId], newIds: [copyId] }];
  // duplicateItems nudges visual copies down / puts sfx after; put the copy back in place.
  if (item.kind === "sfx") cmds.push({ type: "moveItem", itemId: copyId, startMs: item.startMs });
  else cmds.push({ type: "updateItem", itemId: copyId, patch: { transform: { y: item.transform.y } } });
  cmds.push({ type: "trimItem", itemId, edge: "end", ms: atMs }, { type: "trimItem", itemId: copyId, edge: "start", ms: atMs });
  return { cmds, newId: copyId };
}

/** S: split the selected track items under the playhead, otherwise the clip at the playhead. */
export function splitSelectionAtPlayhead() {
  const at = ui().currentMs;
  const splits = ui()
    .selected.filter(isItemSel)
    .map((s) => splitItemCommands(s.id, at))
    .filter((x) => !!x);
  if (!splits.length) return splitAtPlayhead();
  if (apply(splits.flatMap((x) => x.cmds))) toast(`Split at ${formatTime(at, true)}`, { action: undoAction });
}

/** Speed for the selected clips (or the target clip). */
export function setClipSpeed(speed: number) {
  if (!needEdited()) return;
  const sel = ui().selected.filter((s) => s.kind === "clip").map((s) => s.id);
  const ids = sel.length ? sel : [targetClip().id];
  if (apply(ids.map((clipId) => ({ type: "updateClip" as const, clipId, patch: { speed } }))))
    toast(`Speed ${speed}×`, { action: undoAction });
}

/** Copy / paste a text item's look. */
export function copyTextStyle(itemId: string) {
  const hit = findItem(itemId);
  if (hit?.item.kind !== "text") return;
  useTimelineView.getState().setTextStyle(structuredClone(hit.item.style));
  toast("Style copied", { description: "Right-click another text and choose Paste style." });
}

export function pasteTextStyle(itemIds: string[]) {
  const style = useTimelineView.getState().textStyle;
  if (!style) return;
  const ids = itemIds.filter((id) => findItem(id)?.item.kind === "text");
  if (apply(ids.map((itemId) => ({ type: "updateItem" as const, itemId, patch: { style } })))) toast("Style pasted", { action: undoAction });
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
