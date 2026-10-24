"use client";

import { create } from "zustand";
import type { EditCommand } from "@/lib/edit-plan/commands";
import type { Canvas, Clip, Source, Transform, VisualItem } from "@/lib/edit-plan/schema";
import { animate } from "@/remotion/animate";

// Canvas editing math: where things sit on the preview, in composition pixels
// (the canvas resolution) and in screen pixels. Everything mirrors the render
// in remotion/short-video.tsx and remotion/items.tsx, so a handle drawn here
// sits exactly on the pixels the Player (and the export) draws.

export type Point = { x: number; y: number };
export type Size = { width: number; height: number };

/**
 * An oriented box in composition px: center, unscaled layout size, rotation
 * (degrees, clockwise) and scale (sx/sy differ only while free-resizing a shape).
 */
export type Box = { cx: number; cy: number; w: number; h: number; rotation: number; sx: number; sy: number };

export type Rect = { left: number; top: number; right: number; bottom: number };

/* ---------- composition ↔ screen ---------- */

/** How the Player draws the composition into a frame of `frame` size: uniform scale, centered. */
export function stageTransform(frame: { w: number; h: number }, canvas: Size, zoom = 1) {
  const k = Math.min(frame.w / canvas.width, frame.h / canvas.height) * zoom;
  return { k, ox: (frame.w - canvas.width * k) / 2, oy: (frame.h - canvas.height * k) / 2 };
}

export type Stage = ReturnType<typeof stageTransform>;

/** Screen point (relative to the frame's top-left) → composition px. */
export const toCanvas = (p: Point, s: Stage): Point => ({ x: (p.x - s.ox) / s.k, y: (p.y - s.oy) / s.k });

/** Composition px → screen point relative to the frame's top-left. */
export const toScreen = (p: Point, s: Stage): Point => ({ x: s.ox + p.x * s.k, y: s.oy + p.y * s.k });

/* ---------- boxes ---------- */

/**
 * Box of a track item as rendered at output time `t` (animation included), or at
 * rest when `t` is omitted. `size` is the item's layout size (its offsetWidth/Height).
 */
export function itemBox(item: VisualItem, size: Size, canvas: Size, t?: number): Box {
  const tr = item.transform;
  const a = t === undefined ? null : animate(item.animation, t - item.startMs, item.endMs - item.startMs);
  const s = tr.scale * (a?.scale ?? 1);
  return {
    cx: tr.x * canvas.width + (a?.dx ?? 0) * canvas.width,
    cy: tr.y * canvas.height + (a?.dy ?? 0) * canvas.height,
    w: size.width,
    h: size.height,
    rotation: tr.rotation + (a?.rotate ?? 0),
    sx: s,
    sy: s,
  };
}

/** The picture area of a clip inside the canvas (before its transform). */
export function clipContentSize(clip: Clip, source: Pick<Source, "width" | "height">, canvas: Size): Size {
  if (clip.frame.fit === "fill") return { width: canvas.width, height: canvas.height };
  const c = clip.crop;
  const ar = (source.width * (1 - c.left - c.right)) / Math.max(1, source.height * (1 - c.top - c.bottom));
  return ar > canvas.width / canvas.height
    ? { width: canvas.width, height: canvas.width / ar }
    : { width: canvas.height * ar, height: canvas.height };
}

type ClipView = { zoom?: { scale: number; focusX: number; focusY: number } | null; span?: { outStart: number; outEnd: number }; t?: number };

/**
 * Box of a clip's picture: frame translate/scale/rotate, then the clip's in/out
 * animation (around the canvas center), then the auto-zoom (around its focus point).
 */
export function clipBox(clip: Clip, source: Pick<Source, "width" | "height">, canvas: Size, view: ClipView = {}): Box {
  const { width: W, height: H } = canvas;
  const f = clip.frame;
  const size = clipContentSize(clip, source, canvas);
  const a = view.span && view.t !== undefined ? animate(clip.animation, view.t - view.span.outStart, view.span.outEnd - view.span.outStart) : null;
  const sc = a?.scale ?? 1;
  let cx = W / 2 + (a?.dx ?? 0) * W + sc * f.x * W;
  let cy = H / 2 + (a?.dy ?? 0) * H + sc * f.y * H;
  let scale = f.scale * sc;
  const z = view.zoom;
  if (z) {
    const fx = z.focusX * W;
    const fy = z.focusY * H;
    cx = fx + z.scale * (cx - fx);
    cy = fy + z.scale * (cy - fy);
    scale *= z.scale;
  }
  return { cx, cy, w: size.width, h: size.height, rotation: f.rotate, sx: scale, sy: scale };
}

const rad = (deg: number) => (deg * Math.PI) / 180;

/** Corners of a box (clockwise from top-left) in composition px. */
export function boxCorners(b: Box): Point[] {
  const cos = Math.cos(rad(b.rotation));
  const sin = Math.sin(rad(b.rotation));
  const hw = (b.w * b.sx) / 2;
  const hh = (b.h * b.sy) / 2;
  return [
    [-hw, -hh],
    [hw, -hh],
    [hw, hh],
    [-hw, hh],
  ].map(([x, y]) => ({ x: b.cx + x * cos - y * sin, y: b.cy + x * sin + y * cos }));
}

/** True if `p` is inside the (rotated, scaled) box. `pad` grows the box, in composition px. */
export function hitBox(p: Point, b: Box, pad = 0): boolean {
  const cos = Math.cos(rad(-b.rotation));
  const sin = Math.sin(rad(-b.rotation));
  const dx = p.x - b.cx;
  const dy = p.y - b.cy;
  const lx = dx * cos - dy * sin;
  const ly = dx * sin + dy * cos;
  return Math.abs(lx) <= Math.abs(b.w * b.sx) / 2 + pad && Math.abs(ly) <= Math.abs(b.h * b.sy) / 2 + pad;
}

/** The topmost hit. `boxes` are bottom layer first (the order the render draws them). */
export function topmostAt<T extends { box: Box }>(p: Point, boxes: T[], pad = 0): T | null {
  for (let i = boxes.length - 1; i >= 0; i--) if (hitBox(p, boxes[i].box, pad)) return boxes[i];
  return null;
}

/** Axis-aligned bounds of a box. */
export function boxBounds(b: Box): Rect {
  const c = boxCorners(b);
  const xs = c.map((p) => p.x);
  const ys = c.map((p) => p.y);
  return { left: Math.min(...xs), top: Math.min(...ys), right: Math.max(...xs), bottom: Math.max(...ys) };
}

export function unionBounds(rects: Rect[]): Rect {
  return {
    left: Math.min(...rects.map((r) => r.left)),
    top: Math.min(...rects.map((r) => r.top)),
    right: Math.max(...rects.map((r) => r.right)),
    bottom: Math.max(...rects.map((r) => r.bottom)),
  };
}

/* ---------- align ---------- */

export type AlignMode = "left" | "center" | "right" | "top" | "middle" | "bottom";

/**
 * New centers (as canvas fractions) that align each box's bounds to the canvas,
 * or, with `toSelection`, to the bounds of all the boxes together.
 */
export function alignPositions(entries: { id: string; box: Box }[], mode: AlignMode, canvas: Size, toSelection = false) {
  if (!entries.length) return [];
  const bounds = entries.map((e) => boxBounds(e.box));
  const target = toSelection && entries.length > 1 ? unionBounds(bounds) : { left: 0, top: 0, right: canvas.width, bottom: canvas.height };
  return entries.map((e, i) => {
    const b = bounds[i];
    let { cx, cy } = e.box;
    if (mode === "left") cx += target.left - b.left;
    if (mode === "right") cx += target.right - b.right;
    if (mode === "center") cx += (target.left + target.right) / 2 - (b.left + b.right) / 2;
    if (mode === "top") cy += target.top - b.top;
    if (mode === "bottom") cy += target.bottom - b.bottom;
    if (mode === "middle") cy += (target.top + target.bottom) / 2 - (b.top + b.bottom) / 2;
    return { id: e.id, x: clamp01(cx / canvas.width), y: clamp01(cy / canvas.height) };
  });
}

const clamp01 = (v: number) => Math.min(1, Math.max(0, +v.toFixed(5)));

/* ---------- snapping ---------- */

/** Areas covered by TikTok / Reels UI, as canvas fractions (also drawn as the safe-zone guide). */
export const SAFE_ZONE = { top: 0.09, bottom: 0.2, right: 0.15, rightFrom: 0.3, rightTo: 0.8 } as const;

/**
 * Snap lines in screen px (relative to the frame): canvas edges and center lines,
 * plus the safe-zone edges when guides are on.
 */
export function snapLines(canvas: Size, stage: Stage, safeZones: boolean) {
  const xs = [0, 0.5, 1, ...(safeZones ? [1 - SAFE_ZONE.right] : [])];
  const ys = [0, 0.5, 1, ...(safeZones ? [SAFE_ZONE.top, 1 - SAFE_ZONE.bottom] : [])];
  return {
    vertical: xs.map((f) => +(stage.ox + f * canvas.width * stage.k).toFixed(2)),
    horizontal: ys.map((f) => +(stage.oy + f * canvas.height * stage.k).toFixed(2)),
  };
}

/** Items whose edges/centers act as snap targets while dragging `movingIds`. */
export const snapTargetIds = (visibleIds: string[], movingIds: string[]) => visibleIds.filter((id) => !movingIds.includes(id));

/** Nearest multiple of `step` degrees (Shift-rotate), kept in −360…360. */
export const snapAngle = (deg: number, step = 15) => Math.max(-360, Math.min(360, Math.round(deg / step) * step));

/* ---------- transforms ---------- */

/** Move an item by a screen-px drag. */
export function movedTransform(start: Pick<Transform, "x" | "y">, dist: [number, number], stage: Stage, canvas: Size) {
  return {
    x: clamp01(start.x + dist[0] / stage.k / canvas.width),
    y: clamp01(start.y + dist[1] / stage.k / canvas.height),
  };
}

/** Arrow-key nudge in composition px. */
export function nudgedTransform(t: Pick<Transform, "x" | "y">, dx: number, dy: number, canvas: Size) {
  return { x: clamp01(t.x + dx / canvas.width), y: clamp01(t.y + dy / canvas.height) };
}

/** CSS for a proxy box drawn in screen px. Same transform order as the render. */
export function proxyStyle(b: Box, s: Stage) {
  return {
    left: s.ox + b.cx * s.k,
    top: s.oy + b.cy * s.k,
    width: b.w * s.k,
    height: b.h * s.k,
    transform: `translate(-50%, -50%) rotate(${b.rotation}deg) scale(${b.sx}, ${b.sy})`,
  };
}

/* ---------- DOM ---------- */

/** Layout size of an item as the Player draws it (null when it isn't on screen now). */
export function measureItem(id: string): Size | null {
  if (typeof document === "undefined") return null;
  const el = document.querySelector<HTMLElement>(`[data-preview-frame] [data-item="${CSS.escape(id)}"]`);
  return el ? { width: el.offsetWidth, height: el.offsetHeight } : null;
}

/* ---------- transient state ---------- */

type CanvasState = {
  /** Commands previewed on the Player during a drag; dispatched once on release. */
  preview: EditCommand[] | null;
  setPreview: (cmds: EditCommand[] | null) => void;
  /** Text item being edited in place. */
  editingId: string | null;
  setEditingId: (id: string | null) => void;
  /** Crop dialog for this clip. */
  cropClipId: string | null;
  setCropClipId: (id: string | null) => void;
};

export const useCanvasStore = create<CanvasState>()((set) => ({
  preview: null,
  setPreview: (preview) => set({ preview }),
  editingId: null,
  setEditingId: (editingId) => set({ editingId }),
  cropClipId: null,
  setCropClipId: (cropClipId) => set({ cropClipId }),
}));

export type { Canvas };
