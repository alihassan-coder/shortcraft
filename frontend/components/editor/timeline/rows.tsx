"use client";

import { memo, useState } from "react";
import {
  Captions,
  Clapperboard,
  Eye,
  EyeOff,
  GripVertical,
  Lock,
  LockOpen,
  Music2,
  Volume2,
  VolumeX,
  ZoomIn,
} from "lucide-react";
import { trackById as musicById } from "@/lib/edit-plan/music-library";
import type { EditPlan, Item, Track } from "@/lib/edit-plan/schema";
import { sfxById } from "@/lib/edit-plan/sfx-library";
import { stickerById } from "@/lib/edit-plan/stickers";
import type { Piece, ResolvedTimeline } from "@/lib/edit-plan/timeline";
import { dispatch } from "@/lib/editor/store";
import { clipOutputLength, msToPx, overlaps } from "@/lib/editor/timeline-view";
import { cn } from "@/lib/utils";
import { openTab } from "../assets";
import { FilmStrip, Waveform } from "./media";
import { TransitionButton } from "./menus";
import { KIND_ICON, itemSelKind, type Drag, type RowModel } from "./model";

export type Range = { from: number; to: number };


/* ---------- headers ---------- */

function HeaderButton({
  label,
  active,
  hoverOnly,
  onClick,
  children,
}: {
  label: string;
  active?: boolean;
  /** Hidden until the header is hovered (unless active), to keep track names readable. */
  hoverOnly?: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      aria-pressed={active}
      title={label}
      onClick={onClick}
      className={cn(
        "grid size-6 place-items-center rounded-[6px] text-muted-foreground transition-colors hover:bg-surface hover:text-ink focus-visible:ring-2 focus-visible:ring-rec/40 focus-visible:outline-none",
        active && "text-ink",
        hoverOnly && !active && "hidden group-hover/header:grid focus-visible:grid",
      )}
    >
      {children}
    </button>
  );
}

const ICON = "size-3.5";

export const RowHeader = memo(function RowHeader({
  row,
  captionsOn,
  zoomsOn,
  renaming,
  onRenamed,
  dropTarget,
}: {
  row: RowModel;
  captionsOn: boolean;
  zoomsOn: boolean;
  renaming: boolean;
  onRenamed: () => void;
  dropTarget: boolean;
}) {
  const base = "sticky left-0 z-20 flex shrink-0 items-center gap-1.5 border-r border-b bg-white pr-1.5 pl-2 text-xs";
  if (row.type !== "track") {
    const info = {
      captions: { icon: Captions, name: "Captions" },
      video: { icon: Clapperboard, name: "Main video" },
      zoom: { icon: ZoomIn, name: "Zoom" },
      music: { icon: Music2, name: "Music" },
    }[row.type];
    const Icon = info.icon;
    return (
      <div className={cn(base, "pl-[22px]")} style={{ width: 156, height: row.h }} data-tl-header={row.type}>
        <Icon className={cn(ICON, "shrink-0 text-ink-2")} />
        <span className={cn("min-w-0 flex-1 truncate font-medium text-ink-2", row.type === "video" && "text-ink")}>{info.name}</span>
        {row.type === "captions" && (
          <HeaderButton
            label={captionsOn ? "Hide captions" : "Show captions"}
            onClick={() => dispatch({ type: "setCaptions", captions: { enabled: !captionsOn } })}
          >
            {captionsOn ? <Eye className={ICON} /> : <EyeOff className={ICON} />}
          </HeaderButton>
        )}
        {row.type === "zoom" && (
          <HeaderButton label={zoomsOn ? "Turn zooms off" : "Turn zooms on"} onClick={() => dispatch({ type: "setZoomsEnabled", enabled: !zoomsOn })}>
            {zoomsOn ? <Eye className={ICON} /> : <EyeOff className={ICON} />}
          </HeaderButton>
        )}
      </div>
    );
  }

  const { track } = row;
  const Icon = KIND_ICON[track.kind];
  const update = (patch: Partial<Pick<Track, "locked" | "hidden" | "muted" | "name">>) =>
    dispatch({ type: "updateTrack", trackId: track.id, patch });
  return (
    <div
      className={cn(base, "group/header", dropTarget && "bg-surface shadow-[inset_0_2px_0_var(--ink)]")}
      style={{ width: 156, height: row.h }}
      data-tl-header="track"
      data-track-id={track.id}
    >
      <span data-tl-grip className="-ml-1 grid h-full w-3.5 cursor-grab place-items-center text-muted-foreground/0 group-hover/header:text-muted-foreground active:cursor-grabbing">
        <GripVertical className="size-3" />
      </span>
      <Icon className={cn(ICON, "shrink-0 text-ink-2")} />
      {renaming ? (
        <RenameInput name={track.name} onDone={(name) => (name !== null && update({ name }), onRenamed())} />
      ) : (
        <span className={cn("min-w-0 flex-1 truncate font-medium text-ink-2", track.hidden && "text-muted-foreground line-through")} title={track.name}>
          {track.name}
        </span>
      )}
      {track.kind === "sfx" ? (
        <HeaderButton label={track.muted ? "Unmute track" : "Mute track"} active={track.muted} hoverOnly onClick={() => update({ muted: !track.muted })}>
          {track.muted ? <VolumeX className={ICON} /> : <Volume2 className={ICON} />}
        </HeaderButton>
      ) : (
        <HeaderButton label={track.hidden ? "Show track" : "Hide track"} active={track.hidden} hoverOnly onClick={() => update({ hidden: !track.hidden })}>
          {track.hidden ? <EyeOff className={ICON} /> : <Eye className={ICON} />}
        </HeaderButton>
      )}
      <HeaderButton label={track.locked ? "Unlock track" : "Lock track"} active={track.locked} hoverOnly onClick={() => update({ locked: !track.locked })}>
        {track.locked ? <Lock className={ICON} /> : <LockOpen className={ICON} />}
      </HeaderButton>
    </div>
  );
});

function RenameInput({ name, onDone }: { name: string; onDone: (name: string | null) => void }) {
  const [value, setValue] = useState(name);
  return (
    <input
      autoFocus
      aria-label="Track name"
      value={value}
      onChange={(e) => setValue(e.target.value)}
      onFocus={(e) => e.target.select()}
      onBlur={() => onDone(value.trim() ? value.trim() : null)}
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.key === "Enter") (e.target as HTMLInputElement).blur();
        if (e.key === "Escape") onDone(null);
      }}
      className="h-6 min-w-0 flex-1 rounded-[6px] border border-ink bg-white px-1.5 text-xs outline-none"
    />
  );
}

/* ---------- shared pieces ---------- */

const LANE = "relative shrink-0 border-b";

function Handles({ show }: { show: boolean }) {
  const h = "absolute inset-y-0 z-[2] w-2 cursor-ew-resize";
  const bar = "absolute inset-y-[5px] w-[3px] rounded-full bg-current opacity-0 transition-opacity";
  return (
    <>
      <span data-tl-handle="start" className={cn(h, "left-0")} aria-hidden>
        <span className={cn(bar, "left-[2px]", show ? "opacity-70" : "group-hover/block:opacity-50")} />
      </span>
      <span data-tl-handle="end" className={cn(h, "right-0")} aria-hidden>
        <span className={cn(bar, "right-[2px]", show ? "opacity-70" : "group-hover/block:opacity-50")} />
      </span>
    </>
  );
}

function itemLabel(item: Item) {
  switch (item.kind) {
    case "text":
      return item.text || "Empty text";
    case "element":
      return item.element.type === "emoji"
        ? item.element.emoji
        : item.element.type === "sticker"
          ? (stickerById(item.element.stickerId)?.label ?? "Sticker")
          : item.element.shape[0].toUpperCase() + item.element.shape.slice(1);
    case "image":
      return "Image";
    case "sfx":
      return sfxById(item.sfxId)?.name ?? item.sfxId;
  }
}

/* ---------- track lanes ---------- */

type ShownItem = { item: Item; start: number; end: number; ghost: boolean };

export const ItemsLane = memo(function ItemsLane({
  row,
  allTracks,
  pps,
  range,
  width,
  selected,
  drag,
}: {
  row: Extract<RowModel, { type: "track" }>;
  allTracks: Track[];
  pps: number;
  range: Range;
  width: number;
  selected: Set<string>;
  drag: Drag | null;
}) {
  const { track } = row;
  const shown: ShownItem[] = [];
  const moving = drag?.type === "move-items" ? drag : null;
  for (const item of track.items) {
    if (moving?.ids.includes(item.id)) {
      if (moving.toTrackId !== track.id) continue;
      shown.push({ item, start: item.startMs + moving.deltaMs, end: item.endMs + moving.deltaMs, ghost: true });
    } else if (drag?.type === "trim-item" && drag.id === item.id) {
      shown.push(drag.edge === "start" ? { item, start: drag.ms, end: item.endMs, ghost: true } : { item, start: item.startMs, end: drag.ms, ghost: true });
    } else shown.push({ item, start: item.startMs, end: item.endMs, ghost: false });
  }
  // Items dragged in from another track of the same kind.
  if (moving && moving.toTrackId === track.id && moving.fromTrackId !== track.id) {
    const from = allTracks.find((t) => t.id === moving.fromTrackId);
    for (const item of from?.items ?? [])
      if (moving.ids.includes(item.id)) shown.push({ item, start: item.startMs + moving.deltaMs, end: item.endMs + moving.deltaMs, ghost: true });
  }

  return (
    <div
      className={cn(LANE, track.locked && "bg-[repeating-linear-gradient(135deg,transparent_0_6px,rgba(0,0,0,.035)_6px_8px)]")}
      style={{ width, height: row.h }}
      data-tl-lane="track"
      data-track-id={track.id}
      data-track-kind={track.kind}
    >
      {shown
        .filter((s) => overlaps(s.start, s.end, range))
        .map(({ item, start, end, ghost }) => {
          const isSel = selected.has(`${itemSelKind(item)}:${item.id}`);
          const left = msToPx(start, pps);
          const w = Math.max(4, msToPx(end - start, pps));
          return (
            <div
              key={item.id}
              data-testid="timeline-item"
              data-item-id={item.id}
              data-item-kind={item.kind}
              data-tl-kind="item"
              data-id={item.id}
              data-track-id={track.id}
              data-start={Math.round(item.startMs)}
              title={`${itemLabel(item)}`}
              className={cn(
                "group/block absolute top-[3px] bottom-[3px] flex items-center overflow-clip rounded-[6px] border text-[11px] leading-none font-medium select-none",
                track.locked ? "cursor-not-allowed" : "cursor-grab active:cursor-grabbing",
                isSel ? "z-[3] border-ink bg-ink text-white shadow-[0_0_0_1.5px_var(--rec)]" : "border-[#d6d6dc] bg-white text-ink hover:border-ink/40",
                (track.hidden || (track.kind === "sfx" && track.muted)) && "opacity-45",
                ghost && "z-[4] shadow-[0_2px_8px_rgba(0,0,0,.14)]",
              )}
              style={{ left, width: w }}
            >
              {item.kind === "image" && item.src ? (
                // eslint-disable-next-line @next/next/no-img-element -- tiny timeline thumbnail
                <img src={item.src} alt="" draggable={false} className="ml-1 size-5 shrink-0 rounded-[3px] object-cover" />
              ) : null}
              {/* Sticky so the label stays readable when the item starts off screen. */}
              <span className={cn("sticky left-[156px] truncate px-2", item.kind === "element" && item.element.type === "emoji" && "text-[13px]")}>
                {itemLabel(item)}
              </span>
              {!track.locked && <Handles show={isSel} />}
            </div>
          );
        })}
    </div>
  );
});

/* ---------- captions ---------- */

export const CaptionsLane = memo(function CaptionsLane({
  tl,
  plan,
  pps,
  range,
  width,
  h,
}: {
  tl: ResolvedTimeline;
  plan: EditPlan;
  pps: number;
  range: Range;
  width: number;
  h: number;
}) {
  const on = plan.captions.enabled;
  const highlights = new Set(plan.captions.highlights);
  return (
    <div className={cn(LANE, "bg-surface/50")} style={{ width, height: h }} data-tl-lane="captions">
      {tl.lines
        .filter((l) => overlaps(l.start, l.end, range))
        .map((l) => (
          <button
            key={l.words[0].key}
            type="button"
            data-tl-kind="caption"
            data-start={l.start}
            tabIndex={-1}
            className={cn(
              "absolute top-[4px] bottom-[4px] flex items-center gap-[3px] overflow-hidden rounded-[5px] border border-[#dcdce2] bg-white px-1.5 text-[10.5px] whitespace-nowrap text-ink-2 hover:border-ink/40",
              !on && "opacity-40",
            )}
            style={{ left: msToPx(l.start, pps), width: Math.max(3, msToPx(l.end - l.start, pps) - 1) }}
            title={l.words.map((w) => w.display).join(" ")}
          >
            {l.words.map((w) => (
              <span key={w.key} className={cn(highlights.has(w.id) && "rounded-[2px] bg-caption px-0.5 text-ink")}>
                {w.display}
              </span>
            ))}
          </button>
        ))}
    </div>
  );
});

/* ---------- main video ---------- */

export const VideoLane = memo(function VideoLane({
  plan,
  tl,
  pps,
  range,
  width,
  h,
  selected,
  drag,
}: {
  plan: EditPlan;
  tl: ResolvedTimeline;
  pps: number;
  range: Range;
  width: number;
  h: number;
  selected: Set<string>;
  drag: Drag | null;
}) {
  const trim = drag?.type === "trim-clip" ? drag : null;
  const move = drag?.type === "move-clip" ? drag : null;
  const trimIndex = trim ? tl.clipSpans.findIndex((s) => s.clipId === trim.clipId) : -1;
  const sources = new Map(plan.sources.map((s) => [s.id, s]));
  const clips = new Map(plan.clips.map((c, i) => [c.id, { clip: c, index: i }]));
  const stripH = h - 6 - 14;

  return (
    <div className={cn(LANE, "bg-surface")} style={{ width, height: h }} data-tl-lane="video">
      {tl.clipSpans.map((span, i) => {
        const entry = clips.get(span.clipId);
        if (!entry) return null;
        const { clip, index } = entry;
        const source = sources.get(clip.sourceId);
        let outStart = span.outStart;
        let outEnd = span.outEnd;
        if (trim && i === trimIndex) {
          const newLen = clipOutputLength(plan, { ...clip, [trim.edge === "in" ? "inMs" : "outMs"]: trim.srcMs });
          if (trim.edge === "out") outEnd = outStart + newLen;
          else outStart = outEnd - newLen;
        } else if (trim?.edge === "out" && i > trimIndex) {
          outStart += trim.deltaMs;
          outEnd += trim.deltaMs;
        }
        if (!overlaps(outStart, outEnd, range) && !(move?.clipId === span.clipId)) return null;
        const pieces = tl.pieces.filter((p: Piece) => p.clipId === span.clipId);
        const isSel = selected.has(`clip:${span.clipId}`);
        const dragging = move?.clipId === span.clipId;
        const left = msToPx(outStart, pps);
        const w = Math.max(6, msToPx(outEnd - outStart, pps));
        const shift = span.outStart - outStart; // pieces are positioned from the original start
        return (
          <div
            key={span.clipId}
            data-testid="timeline-clip"
            data-clip-id={span.clipId}
            data-tl-kind="clip"
            data-id={span.clipId}
            data-index={i}
            className={cn(
              "group/block absolute top-[3px] bottom-[3px] cursor-grab overflow-hidden rounded-[6px] bg-[#dcdce2] text-white select-none active:cursor-grabbing",
              isSel && "z-[3]",
              dragging && "z-[6] opacity-90 shadow-[0_4px_16px_rgba(0,0,0,.22)]",
            )}
            style={{ left, width: w, transform: dragging ? `translateX(${move.dxPx}px)` : undefined }}
          >
            {source && (
              <>
                <FilmStrip
                  src={source.src}
                  poster={source.poster}
                  pieces={pieces}
                  outStart={span.outStart}
                  outEnd={span.outStart + (outEnd - outStart)}
                  pps={pps}
                  from={range.from + shift}
                  to={range.to + shift}
                  height={stripH}
                />
                <div className="absolute inset-x-0 bottom-0 h-[14px] border-t border-black/5 bg-[#ececf0]">
                  <Waveform
                    src={source.src}
                    pieces={pieces}
                    outStart={span.outStart}
                    outEnd={span.outStart + (outEnd - outStart)}
                    pps={pps}
                    from={range.from + shift}
                    to={range.to + shift}
                    height={14}
                    muted={clip.muted || clip.volume === 0}
                  />
                </div>
              </>
            )}
            {/* Cuts inside the clip: a hairline where kept pieces meet. */}
            {pieces.slice(1).map((p) => (
              <span
                key={p.key}
                className="pointer-events-none absolute top-0 w-px bg-cut/70"
                style={{ left: msToPx(p.outStart - span.outStart, pps), height: stripH }}
                title="Cut"
              />
            ))}
            <span className="pointer-events-none absolute top-1 left-1.5 flex items-center gap-1 rounded-[4px] bg-black/55 px-1 py-[1px] font-mono text-[10px] leading-[13px]">
              {index + 1}
              {clip.speed !== 1 && <span className="text-white/80">{clip.speed}×</span>}
              {(clip.muted || clip.volume === 0) && <VolumeX className="size-2.5" />}
            </span>
            <span
              className={cn(
                "pointer-events-none absolute inset-0 rounded-[6px] ring-inset",
                isSel ? "ring-2 ring-rec" : "ring-1 ring-black/10 group-hover/block:ring-ink/30",
              )}
            />
            <Handles show={isSel} />
          </div>
        );
      })}
      {!drag &&
        tl.clipSpans.length > 1 &&
        tl.clipSpans.slice(0, -1).map((span, i) => {
          const clip = clips.get(span.clipId)?.clip;
          if (!clip || !overlaps(span.outEnd, span.outEnd, range)) return null;
          return (
            <TransitionButton
              key={`t-${span.clipId}`}
              clipId={span.clipId}
              nextClipId={tl.clipSpans[i + 1].clipId}
              transition={clip.transition}
              x={msToPx(span.outEnd, pps)}
            />
          );
        })}
    </div>
  );
});

/* ---------- zoom ---------- */

export const ZoomLane = memo(function ZoomLane({
  plan,
  tl,
  pps,
  range,
  width,
  h,
  selected,
  drag,
}: {
  plan: EditPlan;
  tl: ResolvedTimeline;
  pps: number;
  range: Range;
  width: number;
  h: number;
  selected: Set<string>;
  drag: Drag | null;
}) {
  const on = plan.zooms.enabled;
  return (
    <div className={LANE} style={{ width, height: h }} data-tl-lane="zoom">
      {plan.zooms.items.map((z) => {
        const start = tl.toOutputNearest(z.sourceId, z.startMs);
        const end = Math.max(start + 60, tl.toOutputNearest(z.sourceId, z.endMs));
        if (end - start <= 0 || start >= tl.durationMs) return null;
        const offset = drag?.type === "move-zoom" && drag.id === z.id ? drag.deltaMs : 0;
        if (!overlaps(start + offset, end + offset, range)) return null;
        const isSel = selected.has(`zoom:${z.id}`);
        return (
          <div
            key={z.id}
            data-tl-kind="zoom"
            data-id={z.id}
            aria-label={`Zoom ${Math.round(z.scale * 100)}%`}
            className={cn(
              "absolute top-[4px] bottom-[4px] flex cursor-grab items-center overflow-hidden rounded-[5px] border px-1.5 font-mono text-[10px] select-none active:cursor-grabbing",
              isSel ? "z-[3] border-ink bg-ink text-white shadow-[0_0_0_1.5px_var(--rec)]" : "border-[#d6d6dc] bg-white text-ink-2 hover:border-ink/40",
              !on && "opacity-40",
            )}
            style={{ left: msToPx(start + offset, pps), width: Math.max(4, msToPx(end - start, pps)) }}
          >
            <ZoomIn className="mr-1 size-3 shrink-0 opacity-60" />
            {Math.round(z.scale * 100)}%
          </div>
        );
      })}
    </div>
  );
});

/* ---------- music ---------- */

export const MusicLane = memo(function MusicLane({ plan, durationMs, pps, width, h }: { plan: EditPlan; durationMs: number; pps: number; width: number; h: number }) {
  const music = musicById(plan.music.trackId);
  return (
    <div className={LANE} style={{ width, height: h }} data-tl-lane="music">
      {music ? (
        <button
          type="button"
          tabIndex={-1}
          onClick={() => openTab("audio")}
          className="absolute top-[4px] bottom-[4px] left-0 flex items-center gap-1.5 overflow-hidden rounded-[5px] border border-[#d6d6dc] bg-white px-2 text-[11px] whitespace-nowrap text-ink-2 hover:border-ink/40"
          style={{ width: Math.max(4, msToPx(durationMs, pps)) }}
        >
          <Music2 className="size-3 shrink-0" />
          <span className="font-medium text-ink">{music.name}</span>
          <span className="text-muted-foreground">
            {Math.round(plan.music.volume * 100)}%{plan.music.ducking && " · lowers under voice"}
          </span>
        </button>
      ) : (
        <button type="button" tabIndex={-1} onClick={() => openTab("audio")} className="absolute inset-y-0 left-2 text-[11px] text-muted-foreground hover:text-ink">
          Add music…
        </button>
      )}
    </div>
  );
});
