"use client";

import { create } from "zustand";
import type { Clip, EditPlan, Item, TextStyle } from "@/lib/edit-plan/schema";
import { keptRanges, type ResolvedTimeline } from "@/lib/edit-plan/timeline";

// Timeline view model: zoom (px per second), snapping, ruler ticks, trim and
// reorder math. Everything here is pure (unit tested) except the small UI
// store at the bottom. Times are OUTPUT milliseconds unless a name says "src".

/* ---------- px ↔ ms ---------- */

export const MIN_PPS = 8;
export const MAX_PPS = 1200;
export const ZOOM_FACTOR = 1.25;

export const msToPx = (ms: number, pps: number) => (ms / 1000) * pps;
export const pxToMs = (px: number, pps: number) => (px / pps) * 1000;
export const clampPps = (pps: number) => Math.min(MAX_PPS, Math.max(MIN_PPS, pps));

/** Zoom that shows the whole video in `viewPx` (with a little room at the end). */
export function fitPps(durationMs: number, viewPx: number) {
  if (durationMs <= 0 || viewPx <= 0) return 100;
  return clampPps((viewPx * 0.96) / (durationMs / 1000));
}

/** One zoom step in or out (dir = +1 / -1). */
export const stepPps = (pps: number, dir: number) => clampPps(pps * ZOOM_FACTOR ** dir);

/** Slider position (0–1, logarithmic) for a zoom, and back. */
export const ppsToSlider = (pps: number) => Math.log(clampPps(pps) / MIN_PPS) / Math.log(MAX_PPS / MIN_PPS);
export const sliderToPps = (v: number) => clampPps(MIN_PPS * (MAX_PPS / MIN_PPS) ** Math.min(1, Math.max(0, v)));

/** scrollLeft that keeps `anchorMs` under the same screen x (`anchorX`, relative to the lanes' left edge in view) after zooming. */
export const scrollForZoom = (anchorMs: number, anchorX: number, newPps: number) => Math.max(0, msToPx(anchorMs, newPps) - anchorX);

/** Output-time window that is on screen, padded by `marginPx` on each side. */
export function visibleRange(scrollLeft: number, viewPx: number, pps: number, marginPx = 200) {
  return { from: pxToMs(Math.max(0, scrollLeft - marginPx), pps), to: pxToMs(scrollLeft + viewPx + marginPx, pps) };
}

export const overlaps = (aStart: number, aEnd: number, range: { from: number; to: number }) => aEnd >= range.from && aStart <= range.to;

/* ---------- ruler ---------- */

export type Tick = { ms: number; major: boolean; label?: string };

/** Minor and major tick spacing in frames. Minor ticks are ≥ 6px apart, labelled ticks ≥ 64px. */
export function rulerSteps(pps: number, fps: number) {
  const candidates = [1, 2, 5, 10, Math.round(fps / 2), fps, 2 * fps, 5 * fps, 10 * fps, 15 * fps, 30 * fps, 60 * fps, 120 * fps, 300 * fps];
  const px = (frames: number) => msToPx((frames / fps) * 1000, pps);
  const minor = candidates.find((c) => px(c) >= 6) ?? candidates[candidates.length - 1];
  const major = candidates.find((c) => c >= minor && c % minor === 0 && px(c) >= 64) ?? candidates[candidates.length - 1];
  return { minorFrames: minor, majorFrames: major };
}

/** "3s", "15f" (frame inside a second) or "1:05" past a minute. */
export function tickLabel(frame: number, fps: number) {
  const sec = Math.floor(frame / fps);
  const f = frame % fps;
  if (f) return `${f}f`;
  return sec >= 60 ? `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, "0")}` : `${sec}s`;
}

export function rulerTicks(pps: number, fps: number, fromMs: number, toMs: number): Tick[] {
  const { minorFrames, majorFrames } = rulerSteps(pps, fps);
  const ticks: Tick[] = [];
  const first = Math.max(0, Math.floor(((fromMs / 1000) * fps) / minorFrames) * minorFrames);
  const last = ((toMs / 1000) * fps);
  for (let f = first; f <= last && ticks.length < 5000; f += minorFrames) {
    const major = f % majorFrames === 0;
    ticks.push({ ms: (f / fps) * 1000, major, label: major ? tickLabel(f, fps) : undefined });
  }
  return ticks;
}

/** Frame-accurate "m:ss:ff". */
export function formatTimecode(ms: number, fps: number) {
  const frames = Math.round((Math.max(0, ms) / 1000) * fps);
  const s = Math.floor(frames / fps);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}:${String(frames % fps).padStart(2, "0")}`;
}

/** "+0.40s" / "−1.25s". */
export const formatDelta = (ms: number) => `${ms < 0 ? "−" : "+"}${(Math.abs(ms) / 1000).toFixed(2)}s`;

/* ---------- snapping ---------- */

export type SnapKind = "playhead" | "clip" | "item" | "word" | "second";
export type SnapTarget = { ms: number; kind: SnapKind };
export type SnapResult = { ms: number; target: SnapTarget | null };

// On equal distance the more meaningful target wins.
const PRIORITY: Record<SnapKind, number> = { playhead: 0, clip: 1, item: 1, word: 2, second: 3 };

/** Snap threshold in ms for a pixel distance at this zoom. */
export const snapThresholdMs = (pps: number, px = 8) => pxToMs(px, pps);

/** Nearest target within `thresholdMs` (whole seconds count when `seconds` is on). */
export function snapValue(ms: number, targets: SnapTarget[], thresholdMs: number, seconds = true): SnapResult {
  let best: SnapTarget | null = null;
  let bestScore = Infinity;
  const consider = (t: SnapTarget) => {
    const d = Math.abs(t.ms - ms);
    if (d > thresholdMs) return;
    const score = d + PRIORITY[t.kind] * 1e-3;
    if (score < bestScore) {
      best = t;
      bestScore = score;
    }
  };
  targets.forEach(consider);
  if (seconds) consider({ ms: Math.round(ms / 1000) * 1000, kind: "second" });
  const hit = best as SnapTarget | null;
  return hit ? { ms: hit.ms, target: hit } : { ms, target: null };
}

/** Snap a moving range by whichever edge is closer to a target. Returns the delta to add to both edges. */
export function snapRange(startMs: number, endMs: number, targets: SnapTarget[], thresholdMs: number) {
  const a = snapValue(startMs, targets, thresholdMs);
  const b = snapValue(endMs, targets, thresholdMs);
  const da = a.target ? a.ms - startMs : Infinity;
  const db = b.target ? b.ms - endMs : Infinity;
  if (!a.target && !b.target) return { delta: 0, target: null as SnapTarget | null };
  return Math.abs(da) <= Math.abs(db) ? { delta: da, target: a.target } : { delta: db, target: b.target };
}

/** Everything a dragged edge can snap to, except the things being dragged. */
export function snapTargets(
  plan: EditPlan,
  tl: ResolvedTimeline,
  playheadMs: number,
  exclude: { itemIds?: string[]; clipId?: string } = {},
): SnapTarget[] {
  const t: SnapTarget[] = [{ ms: playheadMs, kind: "playhead" }];
  for (const s of tl.clipSpans) {
    if (s.clipId === exclude.clipId) continue;
    t.push({ ms: s.outStart, kind: "clip" }, { ms: s.outEnd, kind: "clip" });
  }
  for (const track of plan.tracks)
    for (const i of track.items) {
      if (exclude.itemIds?.includes(i.id)) continue;
      t.push({ ms: i.startMs, kind: "item" }, { ms: i.endMs, kind: "item" });
    }
  for (const w of tl.words) t.push({ ms: w.outStart, kind: "word" }, { ms: w.outEnd, kind: "word" });
  return t;
}

/* ---------- clips ---------- */

/** Output length of a clip (speed and cuts count). */
export function clipOutputLength(plan: EditPlan, clip: Clip) {
  return keptRanges(plan, clip.sourceId, clip.inMs, clip.outMs).reduce((sum, [s, e]) => sum + (e - s) / clip.speed, 0);
}

/**
 * Source time for a clip edge after dragging it by `deltaOutMs` on the edited
 * timeline. Walks the kept (uncut) source ranges, so speed and cuts are both
 * accounted for. Positive delta moves the edge right.
 */
export function trimClipSrcMs(plan: EditPlan, clipId: string, edge: "in" | "out", deltaOutMs: number): number | null {
  const clip = plan.clips.find((c) => c.id === clipId);
  const source = clip && plan.sources.find((s) => s.id === clip.sourceId);
  if (!clip || !source) return null;
  const length = clipOutputLength(plan, clip);
  if (edge === "out") {
    const target = length + deltaOutMs;
    if (target <= 0) return clip.inMs;
    let acc = 0;
    for (const [s, e] of keptRanges(plan, clip.sourceId, clip.inMs, source.durationMs)) {
      const len = (e - s) / clip.speed;
      if (acc + len >= target) return s + (target - acc) * clip.speed;
      acc += len;
    }
    return source.durationMs;
  }
  const target = length - deltaOutMs;
  if (target <= 0) return clip.outMs;
  let acc = 0;
  for (const [s, e] of keptRanges(plan, clip.sourceId, 0, clip.outMs).reverse()) {
    const len = (e - s) / clip.speed;
    if (acc + len >= target) return e - (target - acc) * clip.speed;
    acc += len;
  }
  return 0;
}

type Span = { outStart: number; outEnd: number };

/** Index to pass to `moveClip` when the dragged clip (at `fromIndex`) is dropped at `pointerMs`. */
export function reorderIndex(spans: Span[], fromIndex: number, pointerMs: number) {
  let n = 0;
  spans.forEach((s, i) => {
    if (i !== fromIndex && (s.outStart + s.outEnd) / 2 < pointerMs) n++;
  });
  return n;
}

/** Where the insert indicator is drawn (current layout) for a `reorderIndex` result. */
export function insertMarkerMs(spans: Span[], fromIndex: number, toIndex: number) {
  const others = spans.filter((_, i) => i !== fromIndex);
  if (!others.length) return 0;
  return toIndex < others.length ? others[toIndex].outStart : others[others.length - 1].outEnd;
}

/* ---------- selection ---------- */

export type Box = { id: string; x0: number; x1: number; y0: number; y1: number };
export type Rect = { x0: number; y0: number; x1: number; y1: number };

export const normRect = (r: Rect): Rect => ({
  x0: Math.min(r.x0, r.x1),
  x1: Math.max(r.x0, r.x1),
  y0: Math.min(r.y0, r.y1),
  y1: Math.max(r.y0, r.y1),
});

/** Ids of boxes the marquee rectangle touches. */
export function marqueeHits(rect: Rect, boxes: Box[]) {
  const r = normRect(rect);
  return boxes.filter((b) => b.x1 >= r.x0 && b.x0 <= r.x1 && b.y1 >= r.y0 && b.y0 <= r.y1).map((b) => b.id);
}

/** Ripple delete: new start for every remaining item that sits after a deleted one on the same track. */
export function rippleMoves(items: Pick<Item, "id" | "startMs" | "endMs">[], deletedIds: string[]) {
  const deleted = items.filter((i) => deletedIds.includes(i.id));
  const moves: { itemId: string; startMs: number }[] = [];
  for (const item of items) {
    if (deletedIds.includes(item.id)) continue;
    const shift = deleted.filter((d) => d.endMs <= item.startMs).reduce((sum, d) => sum + d.endMs - d.startMs, 0);
    if (shift > 0) moves.push({ itemId: item.id, startMs: Math.max(0, item.startMs - shift) });
  }
  return moves;
}

/* ---------- view store (UI only, never in undo) ---------- */

export type CopiedItem = { item: Item; trackId: string; offsetMs: number };

type TimelineView = {
  /** Zoom in px per second; `null` fits the whole video. */
  pps: number | null;
  setPps: (pps: number | null) => void;
  snap: boolean;
  toggleSnap: () => void;
  clipboard: CopiedItem[] | null;
  setClipboard: (c: CopiedItem[] | null) => void;
  textStyle: TextStyle | null;
  setTextStyle: (s: TextStyle | null) => void;
  /** px per second actually in use (fit resolved), reported by the timeline. */
  livePps: number;
  setLivePps: (pps: number) => void;
};

export const useTimelineView = create<TimelineView>()((set) => ({
  pps: null,
  setPps: (pps) => set({ pps: pps === null ? null : clampPps(pps) }),
  snap: true,
  toggleSnap: () => set((s) => ({ snap: !s.snap })),
  clipboard: null,
  setClipboard: (clipboard) => set({ clipboard }),
  textStyle: null,
  setTextStyle: (textStyle) => set({ textStyle }),
  livePps: 100,
  setLivePps: (livePps) => set({ livePps }),
}));

export const timelineZoom = {
  step(dir: number) {
    const v = useTimelineView.getState();
    v.setPps(stepPps(v.pps ?? v.livePps, dir));
  },
  fit: () => useTimelineView.getState().setPps(null),
};
