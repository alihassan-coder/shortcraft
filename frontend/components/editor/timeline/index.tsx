"use client";

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { ContextMenu, ContextMenuTrigger } from "@/components/ui/context-menu";
import type { EditCommand } from "@/lib/edit-plan/commands";
import { resolveTimeline } from "@/lib/edit-plan/timeline";
import { itemSelection } from "@/lib/editor/actions";
import { playerControls } from "@/lib/editor/player";
import { dispatch, usePlanStore, useUiStore, type Selected } from "@/lib/editor/store";
import {
  clampPps,
  clipOutputLength,
  fitPps,
  formatDelta,
  formatTimecode,
  insertMarkerMs,
  marqueeHits,
  msToPx,
  normRect,
  pxToMs,
  reorderIndex,
  rulerTicks,
  scrollForZoom,
  snapRange,
  snapTargets,
  snapThresholdMs,
  snapValue,
  trimClipSrcMs,
  useTimelineView,
  visibleRange,
  type SnapTarget,
} from "@/lib/editor/timeline-view";
import { cn } from "@/lib/utils";
import { AddTrackButton, TimelineMenu, type MenuTarget } from "./menus";
import { END_PAD_PX, HEADER_W, RULER_H, buildRows, itemSelKind, parseSelKey, rowAt, rowsHeight, selKey, selectionBoxes, type Drag } from "./model";
import { CaptionsLane, ItemsLane, MusicLane, RowHeader, VideoLane, ZoomLane } from "./rows";
import { TimelineToolbar } from "./toolbar";

type Session = {
  pointerId: number;
  startX: number;
  startY: number;
  started: boolean;
  threshold: number;
  last: Drag | null;
  /** scrollLeft when the gesture started, so auto-scroll counts towards the drag distance. */
  scroll0: number;
  move: (dx: number, dy: number, e: PointerEvent | React.PointerEvent) => Drag | null;
  up: (drag: Drag | null, e: PointerEvent | React.PointerEvent) => void;
};

const MOVE_THRESHOLD_PX = 3;

/** Multi-track timeline in OUTPUT time: text/element/image tracks, captions, the main video, zoom, music and SFX. */
export function Timeline() {
  const plan = usePlanStore((s) => s.plan);
  const tl = resolveTimeline(plan);
  const original = useUiStore((s) => s.original);
  const currentMs = useUiStore((s) => s.currentMs);
  const playing = useUiStore((s) => s.playing);
  const selectedList = useUiStore((s) => s.selected);
  const selected = useMemo(() => new Set(selectedList.map(selKey)), [selectedList]);
  const zoomPps = useTimelineView((s) => s.pps);
  const setPps = useTimelineView((s) => s.setPps);
  const setLivePps = useTimelineView((s) => s.setLivePps);
  const fps = plan.canvas.fps;

  const scrollRef = useRef<HTMLDivElement>(null);
  const [view, setView] = useState({ left: 0, width: 900 });
  const laneViewW = Math.max(120, view.width - HEADER_W);
  const pps = zoomPps ?? fitPps(tl.durationMs, laneViewW - 16);
  const lanesW = Math.max(laneViewW, msToPx(tl.durationMs, pps) + END_PAD_PX);
  const rows = useMemo(() => buildRows(plan), [plan]);
  const contentH = rowsHeight(rows) + 12;
  // In "Original" preview the player runs on source time; show where that is on the edited timeline.
  const playheadMs = original ? tl.toOutputNearest(plan.sources[0].id, currentMs) : currentMs;

  // Virtualization window, bucketed so scrolling re-renders rows only every 400px.
  const bucketLeft = Math.floor(view.left / 400) * 400;
  const win = visibleRange(bucketLeft, laneViewW + 400, pps, 300);
  const range = useMemo(() => ({ from: win.from, to: win.to }), [win.from, win.to]);

  useEffect(() => setLivePps(pps), [pps, setLivePps]);

  /* ---------- scroll & size ---------- */

  const rafView = useRef(0);
  const measure = useCallback(() => {
    cancelAnimationFrame(rafView.current);
    rafView.current = requestAnimationFrame(() => {
      const el = scrollRef.current;
      if (el) setView((v) => (v.left === el.scrollLeft && v.width === el.clientWidth ? v : { left: el.scrollLeft, width: el.clientWidth }));
    });
  }, []);
  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    setView({ left: el.scrollLeft, width: el.clientWidth });
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [measure]);

  // Keep the point under the cursor (wheel) or the playhead / centre (buttons, keys) still while zooming.
  const anchorRef = useRef<{ ms: number; x: number } | null>(null);
  const prevPps = useRef(pps);
  useLayoutEffect(() => {
    const el = scrollRef.current;
    const before = prevPps.current;
    prevPps.current = pps;
    if (!el || before === pps) return;
    let anchor = anchorRef.current;
    anchorRef.current = null;
    if (!anchor) {
      const phX = msToPx(playheadMs, before) - el.scrollLeft;
      anchor = phX >= 0 && phX <= laneViewW ? { ms: playheadMs, x: phX } : { ms: pxToMs(el.scrollLeft + laneViewW / 2, before), x: laneViewW / 2 };
    }
    el.scrollLeft = zoomPps === null ? 0 : scrollForZoom(anchor.ms, anchor.x, pps);
    measure();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only on zoom changes
  }, [pps]);

  // Ctrl/⌘ + wheel zooms at the cursor (needs a non-passive listener to stop page zoom).
  const ppsRef = useRef(pps);
  useLayoutEffect(() => {
    ppsRef.current = pps;
  }, [pps]);
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      if (!e.ctrlKey && !e.metaKey) return;
      e.preventDefault();
      const rect = el.getBoundingClientRect();
      const x = Math.max(0, e.clientX - rect.left - HEADER_W);
      anchorRef.current = { ms: pxToMs(x + el.scrollLeft, ppsRef.current), x };
      setPps(clampPps(ppsRef.current * Math.exp(-e.deltaY * 0.0018)));
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [setPps]);

  // Follow the playhead while playing.
  const session = useRef<Session | null>(null);
  useEffect(() => {
    const el = scrollRef.current;
    if (!el || !playing || session.current) return;
    const x = msToPx(playheadMs, pps);
    if (x < el.scrollLeft || x > el.scrollLeft + laneViewW - 32) el.scrollLeft = Math.max(0, x - laneViewW * 0.1);
  }, [playheadMs, playing, pps, laneViewW]);

  /* ---------- drag plumbing ---------- */

  const [drag, setDrag] = useState<Drag | null>(null);
  const rafDrag = useRef(0);
  const scheduleDrag = (d: Drag | null) => {
    cancelAnimationFrame(rafDrag.current);
    rafDrag.current = requestAnimationFrame(() => setDrag(d));
  };

  const geometry = () => {
    const el = scrollRef.current!;
    const rect = el.getBoundingClientRect();
    return {
      laneX: (clientX: number) => clientX - rect.left - HEADER_W + el.scrollLeft,
      contentY: (clientY: number) => clientY - rect.top + el.scrollTop,
    };
  };
  const msAt = (clientX: number) => Math.min(tl.durationMs, Math.max(0, pxToMs(geometry().laneX(clientX), pps)));

  const seek = (ms: number) => {
    const t = Math.min(tl.durationMs, Math.max(0, ms));
    if (original) playerControls.seekOutputMs(tl.toSource(t)?.srcMs ?? 0);
    else playerControls.seekOutputMs(t);
  };

  const start = (
    e: React.PointerEvent,
    s: Omit<Session, "pointerId" | "startX" | "startY" | "started" | "last" | "scroll0" | "threshold"> & { threshold?: number },
  ) => {
    scrollRef.current?.setPointerCapture(e.pointerId);
    const threshold = s.threshold ?? MOVE_THRESHOLD_PX;
    session.current = {
      ...s,
      threshold,
      pointerId: e.pointerId,
      startX: e.clientX,
      startY: e.clientY,
      started: threshold === 0,
      last: null,
      scroll0: scrollRef.current?.scrollLeft ?? 0,
    };
  };

  const snapOn = (e: { altKey: boolean }) => useTimelineView.getState().snap && !e.altKey;

  const ui = useUiStore.getState;
  const selectFor = (entry: Selected, shift: boolean) => {
    const key = selKey(entry);
    if (shift) ui().toggleSelected(entry);
    else if (!selected.has(key)) ui().select(entry);
  };

  /* ---------- pointer down: decide what the gesture is ---------- */

  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    const t = e.target as HTMLElement;
    if (t.closest("input, [data-tl-transition], [data-tl-corner]")) return;
    const g = geometry();

    // Track header: drag to reorder (buttons keep their clicks).
    const header = t.closest<HTMLElement>("[data-tl-header]");
    if (header) {
      const trackId = header.dataset.trackId;
      if (t.closest("button") || !trackId) return;
      const from = rows.find((r) => r.type === "track" && r.track.id === trackId);
      if (!from || from.type !== "track") return;
      start(e, {
        move: (_dx, _dy, ev) => {
          const r = rowAt(rows, g.contentY(ev.clientY));
          const to = r && r.type === "track" && r.group === from.group ? r.track.id : trackId;
          return { type: "track", trackId, toTrackId: to };
        },
        up: (d) => {
          if (d?.type !== "track" || d.toTrackId === trackId) return;
          dispatch({ type: "reorderTrack", trackId, toIndex: plan.tracks.findIndex((x) => x.id === d.toTrackId) });
        },
      });
      return;
    }
    if (t.closest("button:not([data-tl-kind])")) return;

    // Ruler or playhead knob: scrub.
    if (t.closest("[data-tl-ruler], [data-tl-playhead]")) {
      e.preventDefault();
      seek(msAt(e.clientX));
      start(e, {
        threshold: 0,
        move: (_dx, _dy, ev) => {
          seek(msAt(ev.clientX));
          return { type: "scrub" };
        },
        up: () => {},
      });
      return;
    }

    const block = t.closest<HTMLElement>("[data-tl-kind]");
    const kind = block?.dataset.tlKind;
    const handle = t.closest<HTMLElement>("[data-tl-handle]")?.dataset.tlHandle as "start" | "end" | undefined;
    const thresholdMs = snapThresholdMs(pps);

    if (block && kind === "item") {
      const id = block.dataset.id!;
      const track = plan.tracks.find((x) => x.items.some((i) => i.id === id));
      const item = track?.items.find((i) => i.id === id);
      if (!track || !item) return;
      const entry = itemSelection(item);
      selectFor(entry, e.shiftKey);
      if (e.shiftKey || track.locked) return;

      if (handle) {
        const targets = snapTargets(plan, tl, playheadMs, { itemIds: [id] });
        const edgeMs = handle === "start" ? item.startMs : item.endMs;
        start(e, {
          move: (dx, _dy, ev) => {
            const raw = edgeMs + pxToMs(dx, pps);
            const s = snapOn(ev) ? snapValue(raw, targets, thresholdMs) : { ms: raw, target: null };
            const ms = handle === "start" ? Math.max(0, Math.min(s.ms, item.endMs - 100)) : Math.max(item.startMs + 100, Math.min(s.ms, tl.durationMs));
            return { type: "trim-item", id, edge: handle, ms, snapMs: s.target ? s.ms : null };
          },
          up: (d) => {
            if (d?.type === "trim-item" && Math.abs(d.ms - edgeMs) > 0.5) dispatch({ type: "trimItem", itemId: id, edge: handle, ms: d.ms });
          },
        });
        return;
      }

      // Move: every selected item on an unlocked track (or just this one).
      const ids = selected.has(selKey(entry))
        ? selectedList
            .filter((s) => s.kind === "text" || s.kind === "item")
            .map((s) => s.id)
            .filter((sid) => plan.tracks.some((tr) => !tr.locked && tr.items.some((i) => i.id === sid)))
        : [id];
      const moving = plan.tracks.flatMap((tr) => tr.items.filter((i) => ids.includes(i.id)).map((i) => ({ i, tr })));
      const sameTrack = moving.every((m) => m.tr.id === track.id);
      const groupStart = Math.min(...moving.map((m) => m.i.startMs));
      const groupEnd = Math.max(...moving.map((m) => m.i.endMs));
      const targets = snapTargets(plan, tl, playheadMs, { itemIds: ids });
      start(e, {
        move: (dx, _dy, ev) => {
          const clampD = (d: number) => Math.max(-groupStart, Math.min(d, Math.max(-groupStart, tl.durationMs - groupEnd)));
          let delta = clampD(pxToMs(dx, pps));
          let snapMs: number | null = null;
          if (snapOn(ev)) {
            const s = snapRange(groupStart + delta, groupEnd + delta, targets, thresholdMs);
            if (s.target) {
              delta = clampD(delta + s.delta);
              snapMs = (s.target as SnapTarget).ms;
            }
          }
          let toTrackId = track.id;
          if (sameTrack) {
            const r = rowAt(rows, g.contentY(ev.clientY));
            if (r?.type === "track" && r.track.kind === track.kind && !r.track.locked) toTrackId = r.track.id;
          }
          return { type: "move-items", ids, fromTrackId: track.id, toTrackId, deltaMs: delta, snapMs };
        },
        up: (d) => {
          if (d?.type !== "move-items") return;
          const moved = d.toTrackId !== d.fromTrackId;
          if (!moved && Math.abs(d.deltaMs) < 0.5) return;
          dispatch(
            moving.map(({ i }): EditCommand => ({
              type: "moveItem",
              itemId: i.id,
              toTrackId: moved ? d.toTrackId : undefined,
              startMs: i.startMs + d.deltaMs,
            })),
          );
        },
      });
      return;
    }

    if (block && kind === "clip") {
      const clipId = block.dataset.id!;
      const index = Number(block.dataset.index);
      const span = tl.clipSpans[index];
      const clip = plan.clips.find((c) => c.id === clipId);
      const source = clip && plan.sources.find((s) => s.id === clip.sourceId);
      if (!span || !clip || !source) return;
      selectFor({ kind: "clip", id: clipId }, e.shiftKey);
      if (e.shiftKey || original) return;

      if (handle) {
        const edge = handle === "start" ? "in" : "out";
        const oldLen = clipOutputLength(plan, clip);
        const targets = snapTargets(plan, tl, playheadMs, { clipId });
        const edgeAt = edge === "out" ? span.outEnd : span.outStart;
        start(e, {
          move: (dx, _dy, ev) => {
            let delta = pxToMs(dx, pps);
            let snapMs: number | null = null;
            if (snapOn(ev)) {
              const s = snapValue(edgeAt + delta, targets, thresholdMs);
              // The in-edge stays put on a magnetic track, so only the out-edge snaps to absolute positions.
              if (s.target && edge === "out") {
                delta = s.ms - edgeAt;
                snapMs = s.ms;
              } else if (s.target && edge === "in") {
                delta = s.ms - edgeAt;
                snapMs = s.ms;
              }
            }
            const raw = trimClipSrcMs(plan, clipId, edge, delta) ?? (edge === "in" ? clip.inMs : clip.outMs);
            const srcMs = edge === "in" ? Math.max(0, Math.min(raw, clip.outMs - 100)) : Math.min(source.durationMs, Math.max(raw, clip.inMs + 100));
            const newLen = clipOutputLength(plan, { ...clip, [edge === "in" ? "inMs" : "outMs"]: srcMs });
            const deltaMs = edge === "out" ? newLen - oldLen : oldLen - newLen;
            return {
              type: "trim-clip",
              clipId,
              edge,
              srcMs,
              deltaMs,
              edgeMs: edge === "out" ? span.outStart + newLen : span.outEnd - newLen,
              snapMs,
            };
          },
          up: (d) => {
            if (d?.type === "trim-clip" && Math.abs(d.deltaMs) > 0.5) dispatch({ type: "trimClip", clipId, edge, srcMs: d.srcMs });
          },
        });
        return;
      }

      start(e, {
        move: (dx, _dy, ev) => {
          const pointerMs = pxToMs(g.laneX(ev.clientX), pps);
          const toIndex = reorderIndex(tl.clipSpans, index, pointerMs);
          return { type: "move-clip", clipId, fromIndex: index, dxPx: dx, toIndex, markerMs: insertMarkerMs(tl.clipSpans, index, toIndex) };
        },
        up: (d, ev) => {
          if (!d) return seek(msAt(ev.clientX));
          if (d.type !== "move-clip" || d.toIndex === d.fromIndex) return;
          const others = tl.clipSpans.filter((_, i) => i !== index);
          const from = plan.clips.findIndex((c) => c.id === clipId);
          let to = plan.clips.length - 1;
          if (d.toIndex < others.length) {
            const target = plan.clips.findIndex((c) => c.id === others[d.toIndex].clipId);
            to = target > from ? target - 1 : target;
          }
          dispatch({ type: "moveClip", clipId, toIndex: to });
        },
      });
      return;
    }

    if (block && kind === "zoom") {
      const id = block.dataset.id!;
      const z = plan.zooms.items.find((x) => x.id === id);
      if (!z) return;
      ui().selectZoom(id);
      const outStart = tl.toOutputNearest(z.sourceId, z.startMs);
      start(e, {
        move: (dx) => ({ type: "move-zoom", id, deltaMs: Math.max(-outStart, pxToMs(dx, pps)) }),
        up: (d) => {
          if (d?.type !== "move-zoom") return seek(outStart);
          const at = tl.toSource(outStart + d.deltaMs);
          if (!at || at.sourceId !== z.sourceId) return;
          const len = z.endMs - z.startMs;
          dispatch({ type: "updateZoom", zoomId: id, patch: { startMs: at.srcMs, endMs: at.srcMs + len } });
        },
      });
      return;
    }

    if (block && kind === "caption") {
      seek(Number(block.dataset.start));
      return;
    }

    // Empty lane: click seeks and clears the selection, drag draws a selection box.
    const lane = t.closest("[data-tl-lane]");
    if (!lane) return;
    const x0 = g.laneX(e.clientX);
    const y0 = g.contentY(e.clientY);
    const base = e.shiftKey ? selectedList : [];
    const boxes = selectionBoxes(rows, tl, pps);
    start(e, {
      move: (_dx, _dy, ev) => {
        const rect = { x0, y0, x1: g.laneX(ev.clientX), y1: g.contentY(ev.clientY) };
        const hits = marqueeHits(rect, boxes).map(parseSelKey);
        const keys = new Set(base.map(selKey));
        ui().setSelected([...base, ...hits.filter((h) => !keys.has(selKey(h)))]);
        return { type: "marquee", ...rect };
      },
      up: (d, ev) => {
        if (d) return;
        if (!ev.shiftKey) ui().select(null);
        seek(msAt(ev.clientX));
      },
    });
  };

  const onPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const s = session.current;
    if (!s) {
      // Hover time on the ruler.
      const onRuler = !!(e.target as HTMLElement).closest("[data-tl-ruler]");
      setHoverMs(onRuler ? msAt(e.clientX) : null);
      return;
    }
    if (e.pointerId !== s.pointerId) return;
    const dx = e.clientX - s.startX;
    const dy = e.clientY - s.startY;
    if (!s.started && Math.hypot(dx, dy) < s.threshold) return;
    s.started = true;
    // Auto-scroll near the edges while dragging.
    const el = scrollRef.current!;
    const rect = el.getBoundingClientRect();
    if (s.last?.type !== "track") {
      if (e.clientX > rect.right - 28) el.scrollLeft += 14;
      else if (e.clientX < rect.left + HEADER_W + 20 && el.scrollLeft > 0) el.scrollLeft -= 14;
    }
    const d = s.move(dx + el.scrollLeft - s.scroll0, dy, e);
    s.last = d;
    scheduleDrag(d);
  };

  const endSession = (e: React.PointerEvent<HTMLDivElement>, cancel = false) => {
    const s = session.current;
    if (!s || e.pointerId !== s.pointerId) return;
    session.current = null;
    cancelAnimationFrame(rafDrag.current);
    setDrag(null);
    scrollRef.current?.releasePointerCapture?.(e.pointerId);
    if (!cancel) s.up(s.started ? s.last : null, e);
  };

  /* ---------- context menu ---------- */

  const [menuTarget, setMenuTarget] = useState<MenuTarget | null>(null);
  const [renaming, setRenaming] = useState<string | null>(null);
  const onContextMenu = (e: React.MouseEvent) => {
    const t = e.target as HTMLElement;
    const block = t.closest<HTMLElement>("[data-tl-kind]");
    const header = t.closest<HTMLElement>("[data-tl-header]");
    const kind = block?.dataset.tlKind;
    const id = block?.dataset.id;
    if (block && id && kind === "item") {
      const item = plan.tracks.flatMap((tr) => tr.items).find((i) => i.id === id);
      if (item && !selected.has(`${itemSelKind(item)}:${id}`)) ui().select(itemSelection(item));
      setMenuTarget({ type: "item", id });
    } else if (block && id && kind === "clip") {
      if (!selected.has(`clip:${id}`)) ui().select({ kind: "clip", id });
      setMenuTarget({ type: "clip", id });
    } else if (block && id && kind === "zoom") {
      ui().selectZoom(id);
      setMenuTarget({ type: "zoom", id });
    } else if (header?.dataset.trackId) {
      setMenuTarget({ type: "track", id: header.dataset.trackId });
    } else if (t.closest("[data-tl-lane]")) {
      setMenuTarget({ type: "lane", ms: msAt(e.clientX) });
    } else {
      e.preventDefault();
      setMenuTarget(null);
    }
  };

  /* ---------- render ---------- */

  const [hoverMs, setHoverMs] = useState<number | null>(null);
  const ticks = rulerTicks(pps, fps, range.from, Math.min(range.to, pxToMs(lanesW, pps)));
  const playX = msToPx(playheadMs, pps);
  const videoRow = rows.find((r) => r.type === "video")!;
  const snapX = drag && "snapMs" in drag && drag.snapMs !== null ? msToPx(drag.snapMs, pps) : null;
  const trimInfo = (() => {
    if (drag?.type === "trim-item") {
      const row = rows.find((r) => r.type === "track" && r.track.items.some((i) => i.id === drag.id));
      const item = row?.type === "track" ? row.track.items.find((i) => i.id === drag.id) : undefined;
      if (!row || !item) return null;
      const len = drag.edge === "start" ? item.endMs - drag.ms : drag.ms - item.startMs;
      return { x: msToPx(drag.ms, pps), y: row.y, text: formatTimecode(drag.ms, fps), sub: `${(len / 1000).toFixed(2)}s` };
    }
    if (drag?.type === "trim-clip") {
      return { x: msToPx(drag.edgeMs, pps), y: videoRow.y, text: formatTimecode(drag.edgeMs, fps), sub: formatDelta(drag.deltaMs) };
    }
    if (drag?.type === "move-items") {
      const row = rows.find((r) => r.type === "track" && r.track.id === drag.toTrackId);
      const first = plan.tracks.flatMap((tr) => tr.items).find((i) => i.id === drag.ids[0]);
      if (!row || !first) return null;
      return { x: msToPx(first.startMs + drag.deltaMs, pps), y: row.y, text: formatTimecode(first.startMs + drag.deltaMs, fps), sub: formatDelta(drag.deltaMs) };
    }
    return null;
  })();
  const marquee = drag?.type === "marquee" ? normRect(drag) : null;

  return (
    <div className="flex h-full min-h-0 flex-col bg-white select-none" data-timeline>
      <TimelineToolbar durationMs={tl.durationMs} />
      {original && (
        <p className="shrink-0 border-b bg-surface px-3 py-1 text-[11px] text-muted-foreground">
          Previewing the original recording. The timeline shows the edited video; edits apply there.
        </p>
      )}
      <ContextMenu>
        <ContextMenuTrigger asChild>
          <div
            ref={scrollRef}
            className="relative min-h-0 flex-1 overflow-auto overscroll-contain [scrollbar-width:thin]"
            onScroll={measure}
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={(e) => endSession(e)}
            onPointerCancel={(e) => endSession(e, true)}
            onPointerLeave={() => setHoverMs(null)}
            onContextMenu={onContextMenu}
            data-tl-scroll
          >
            <div className="relative" style={{ width: HEADER_W + lanesW, height: contentH }}>
              {/* Ruler */}
              <div className="sticky top-0 z-30 flex border-b bg-white" style={{ height: RULER_H, width: HEADER_W + lanesW }}>
                <div data-tl-corner className="sticky left-0 z-40 flex shrink-0 items-center border-r bg-white px-1" style={{ width: HEADER_W }}>
                  <AddTrackButton />
                </div>
                <div className="relative cursor-pointer" style={{ width: lanesW }} data-tl-ruler aria-label="Timeline ruler">
                  {ticks.map((t) => (
                    <span
                      key={t.ms}
                      className={cn("absolute bottom-0 w-px", t.major ? "h-2 bg-ink/35" : "h-1 bg-ink/15")}
                      style={{ left: msToPx(t.ms, pps) }}
                      data-tick={t.major ? "major" : "minor"}
                    >
                      {t.label && <span className="absolute top-[-15px] left-1 font-mono text-[10px] whitespace-nowrap text-muted-foreground">{t.label}</span>}
                    </span>
                  ))}
                  <span className="pointer-events-none absolute inset-y-0 bg-ink/[.035]" style={{ left: msToPx(tl.durationMs, pps), right: 0 }} />
                  {hoverMs !== null && !drag && (
                    <span
                      className="pointer-events-none absolute top-[3px] z-[2] -translate-x-1/2 rounded-[4px] bg-ink px-1 py-px font-mono text-[10px] text-white"
                      style={{ left: msToPx(hoverMs, pps) }}
                    >
                      {formatTimecode(hoverMs, fps)}
                    </span>
                  )}
                  {/* Playhead knob */}
                  <span
                    data-tl-playhead
                    className="absolute bottom-0 z-[3] h-[14px] w-[11px] -translate-x-1/2 cursor-ew-resize"
                    style={{ left: playX }}
                    aria-hidden
                  >
                    <span className="absolute inset-x-0 top-0 h-[9px] rounded-[2px] bg-rec" />
                    <span className="absolute top-[8px] left-1/2 size-[5px] -translate-x-1/2 rotate-45 bg-rec" />
                  </span>
                </div>
              </div>

              {/* Rows */}
              {rows.map((r) => (
                <div key={r.key} className="flex" style={{ height: r.h }} data-tl-row={r.type === "track" ? r.track.kind : r.type}>
                  <RowHeader
                    row={r}
                    captionsOn={plan.captions.enabled}
                    zoomsOn={plan.zooms.enabled}
                    renaming={r.type === "track" && renaming === r.track.id}
                    onRenamed={() => setRenaming(null)}
                    dropTarget={drag?.type === "track" && r.type === "track" && drag.toTrackId === r.track.id && drag.trackId !== r.track.id}
                  />
                  {r.type === "track" ? (
                    <ItemsLane row={r} allTracks={plan.tracks} pps={pps} range={range} width={lanesW} selected={selected} drag={drag} />
                  ) : r.type === "captions" ? (
                    <CaptionsLane tl={tl} plan={plan} pps={pps} range={range} width={lanesW} h={r.h} />
                  ) : r.type === "video" ? (
                    <VideoLane plan={plan} tl={tl} pps={pps} range={range} width={lanesW} h={r.h} selected={selected} drag={drag} />
                  ) : r.type === "zoom" ? (
                    <ZoomLane plan={plan} tl={tl} pps={pps} range={range} width={lanesW} h={r.h} selected={selected} drag={drag} />
                  ) : (
                    <MusicLane plan={plan} durationMs={tl.durationMs} pps={pps} width={lanesW} h={r.h} />
                  )}
                </div>
              ))}

              {/* Overlays (content coordinates) */}
              {playX >= view.left - 1 && (
                <span
                  className="pointer-events-none absolute z-[15] w-px bg-rec"
                  style={{ left: HEADER_W + playX, top: RULER_H, height: contentH - RULER_H }}
                  data-tl-playhead-line
                />
              )}
              {snapX !== null && (
                <span
                  className="pointer-events-none absolute z-[16] w-px bg-ink/70"
                  style={{ left: HEADER_W + snapX, top: RULER_H, height: contentH - RULER_H }}
                  data-tl-snap-line
                />
              )}
              {drag?.type === "move-clip" && drag.toIndex !== drag.fromIndex && (
                <span
                  className="pointer-events-none absolute z-[16] w-[2px] -translate-x-1/2 rounded-full bg-ink"
                  style={{ left: HEADER_W + msToPx(drag.markerMs, pps), top: videoRow.y - 2, height: videoRow.h + 4 }}
                  data-tl-insert
                />
              )}
              {marquee && (
                <span
                  className="pointer-events-none absolute z-[16] rounded-[2px] border border-ink/50 bg-ink/[.06]"
                  style={{ left: HEADER_W + marquee.x0, top: marquee.y0, width: marquee.x1 - marquee.x0, height: marquee.y1 - marquee.y0 }}
                  data-tl-marquee
                />
              )}
              {trimInfo && (
                <span
                  className="pointer-events-none absolute z-[45] flex -translate-x-1/2 items-center gap-1.5 rounded-[6px] bg-ink px-1.5 py-[3px] font-mono text-[10px] whitespace-nowrap text-white shadow-[0_2px_6px_rgba(0,0,0,.2)]"
                  style={{ left: HEADER_W + trimInfo.x, top: Math.max(2, trimInfo.y - 20) }}
                  data-tl-tooltip
                >
                  {trimInfo.text}
                  <span className="text-white/60">{trimInfo.sub}</span>
                </span>
              )}
            </div>
          </div>
        </ContextMenuTrigger>
        <TimelineMenu target={menuTarget} onRename={setRenaming} />
      </ContextMenu>
    </div>
  );
}
