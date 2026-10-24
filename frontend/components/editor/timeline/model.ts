import { AudioLines, ImageIcon, Shapes, Type } from "lucide-react";
import type { EditPlan, Item, Track, TrackKind } from "@/lib/edit-plan/schema";
import type { ResolvedTimeline } from "@/lib/edit-plan/timeline";
import type { Selected } from "@/lib/editor/store";
import { msToPx, type Box } from "@/lib/editor/timeline-view";

// Row layout for the timeline: which rows exist, in what order, and where.
// Visual tracks sit above the main video (top track = top layer), sound
// effects below the music, like a desktop NLE.

export const HEADER_W = 156;
export const RULER_H = 26;
export const TOOLBAR_H = 36;
export const END_PAD_PX = 240;
export const HEIGHTS = { track: 32, sfx: 30, captions: 28, video: 58, zoom: 26, music: 28 } as const;

export type RowModel =
  | { key: string; type: "track"; track: Track; group: "visual" | "sfx"; y: number; h: number }
  | { key: "captions" | "video" | "zoom" | "music"; type: "captions" | "video" | "zoom" | "music"; y: number; h: number };

type WithoutY<T> = T extends unknown ? Omit<T, "y"> : never;

export function buildRows(plan: EditPlan): RowModel[] {
  const rows: RowModel[] = [];
  let y = RULER_H;
  const push = (r: WithoutY<RowModel>) => {
    rows.push({ ...r, y } as RowModel);
    y += r.h;
  };
  const reversed = [...plan.tracks].reverse();
  for (const track of reversed.filter((t) => t.kind !== "sfx"))
    push({ key: track.id, type: "track", track, group: "visual", h: HEIGHTS.track });
  push({ key: "captions", type: "captions", h: HEIGHTS.captions });
  push({ key: "video", type: "video", h: HEIGHTS.video });
  push({ key: "zoom", type: "zoom", h: HEIGHTS.zoom });
  push({ key: "music", type: "music", h: HEIGHTS.music });
  for (const track of reversed.filter((t) => t.kind === "sfx")) push({ key: track.id, type: "track", track, group: "sfx", h: HEIGHTS.sfx });
  return rows;
}

export const rowsHeight = (rows: RowModel[]) => (rows.length ? rows[rows.length - 1].y + rows[rows.length - 1].h : RULER_H);

export const rowAt = (rows: RowModel[], y: number) => rows.find((r) => y >= r.y && y < r.y + r.h);

export const selKey = (s: Selected) => `${s.kind}:${s.id}`;
export const parseSelKey = (k: string): Selected => {
  const i = k.indexOf(":");
  return { kind: k.slice(0, i) as Selected["kind"], id: k.slice(i + 1) };
};

export const itemSelKind = (item: Item): Selected["kind"] => (item.kind === "text" ? "text" : "item");

/** Hit boxes (lane px, content y) for marquee selection. */
export function selectionBoxes(rows: RowModel[], tl: ResolvedTimeline, pps: number): Box[] {
  const boxes: Box[] = [];
  for (const r of rows) {
    if (r.type === "track") {
      if (r.track.locked || r.track.hidden) continue;
      for (const i of r.track.items)
        boxes.push({ id: `${itemSelKind(i)}:${i.id}`, x0: msToPx(i.startMs, pps), x1: msToPx(i.endMs, pps), y0: r.y + 3, y1: r.y + r.h - 3 });
    } else if (r.type === "video") {
      for (const s of tl.clipSpans)
        boxes.push({ id: `clip:${s.clipId}`, x0: msToPx(s.outStart, pps), x1: msToPx(s.outEnd, pps), y0: r.y + 3, y1: r.y + r.h - 3 });
    }
  }
  return boxes;
}

export type Drag =
  | { type: "scrub" }
  | { type: "marquee"; x0: number; y0: number; x1: number; y1: number }
  | { type: "move-items"; ids: string[]; fromTrackId: string; toTrackId: string; deltaMs: number; snapMs: number | null }
  | { type: "trim-item"; id: string; edge: "start" | "end"; ms: number; snapMs: number | null }
  | { type: "trim-clip"; clipId: string; edge: "in" | "out"; srcMs: number; deltaMs: number; edgeMs: number; snapMs: number | null }
  | { type: "move-clip"; clipId: string; fromIndex: number; dxPx: number; toIndex: number; markerMs: number }
  | { type: "move-zoom"; id: string; deltaMs: number }
  | { type: "track"; trackId: string; toTrackId: string };

export const KIND_ICON: Record<TrackKind, typeof Type> = { text: Type, element: Shapes, image: ImageIcon, sfx: AudioLines };
