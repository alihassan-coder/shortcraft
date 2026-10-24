"use client";

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { Player, type PlayerRef } from "@remotion/player";
import { ChevronDown, ClipboardPaste, Copy, Paintbrush, Pause, Play, Scissors, SkipBack, StepBack, StepForward, Trash2 } from "lucide-react";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuShortcut,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { formatTime } from "@/lib/edit-plan/timeline";
import {
  clipAtPlayhead,
  copyStyle,
  deleteClip,
  duplicateClip,
  keyLabel,
  pasteStyle,
  selectClipAtPlayhead,
  splitAtPlayhead,
  toggleOriginal,
} from "@/lib/editor/actions";
import { playerControls, registerPlayer } from "@/lib/editor/player";
import { usePlanStore, useSelectedId, useTimeline, useUiStore, type PreviewZoom } from "@/lib/editor/store";
import { cn } from "@/lib/utils";
import { ShortVideo, planDurationInFrames } from "@/remotion/short-video";
import { IconButton } from "./controls";

export function Preview() {
  const plan = usePlanStore((s) => s.plan);
  const { original, safeZones, setPlaying, setCurrentMs, previewZoom, select } = useUiStore();
  const ref = useRef<PlayerRef>(null);
  const { fps, width, height } = plan.canvas;
  const durationInFrames = planDurationInFrames(plan, original);
  const inputProps = useMemo(() => ({ plan, original }), [plan, original]);
  const box = useRef<HTMLDivElement>(null);
  const fit = useFitSize(box, width, height);
  const frame = previewZoom === "fit" ? fit : { w: Math.round(width * previewZoom), h: Math.round(height * previewZoom) };
  const selectedClip = useSelectedId("clip");
  const clipSelected = !!selectedClip && clipAtPlayhead(plan)?.id === selectedClip;

  const attach = useCallback((node: PlayerRef | null) => {
    ref.current = node;
    registerPlayer(node);
  }, []);

  useEffect(() => {
    const p = ref.current;
    if (!p) return;
    const onFrame = (e: { detail: { frame: number } }) => setCurrentMs((e.detail.frame / fps) * 1000);
    const onPlay = () => setPlaying(true);
    const onPause = () => setPlaying(false);
    p.addEventListener("frameupdate", onFrame);
    p.addEventListener("play", onPlay);
    p.addEventListener("pause", onPause);
    p.addEventListener("ended", onPause);
    return () => {
      p.removeEventListener("frameupdate", onFrame);
      p.removeEventListener("play", onPlay);
      p.removeEventListener("pause", onPause);
      p.removeEventListener("ended", onPause);
    };
  }, [fps, setCurrentMs, setPlaying]);

  return (
    <div className="flex h-full min-h-0 flex-col items-center gap-3">
      <div
        ref={box}
        className={cn("relative min-h-0 w-full flex-1", previewZoom !== "fit" && "overflow-auto")}
        // Clicking the empty stage clears the selection, like any canvas editor.
        onPointerDown={(e) => e.target === e.currentTarget.firstElementChild && select(null)}
      >
        <div className={cn("flex items-center justify-center", previewZoom === "fit" ? "absolute inset-0" : "min-h-full min-w-full p-6")} style={previewZoom === "fit" ? undefined : { width: "max-content" }}>
          <ContextMenu onOpenChange={(open) => open && selectClipAtPlayhead()}>
            <ContextMenuTrigger asChild>
              <div
                data-preview-frame
                className="relative shrink-0 overflow-hidden rounded-[12px] bg-black shadow-frame"
                style={frame ? { width: frame.w, height: frame.h } : { visibility: "hidden" }}
              >
                <Player
                  ref={attach}
                  component={ShortVideo}
                  inputProps={inputProps}
                  durationInFrames={durationInFrames}
                  fps={fps}
                  compositionWidth={width}
                  compositionHeight={height}
                  style={{ width: "100%", height: "100%" }}
                  clickToPlay={false}
                  doubleClickToFullscreen={false}
                  spaceKeyToPlayOrPause={false}
                  acknowledgeRemotionLicense
                />
                {/* Click selects the clip on screen; double-click plays. */}
                <button
                  aria-label="Select clip on screen"
                  className="absolute inset-0 cursor-default outline-none"
                  onClick={selectClipAtPlayhead}
                  onDoubleClick={() => playerControls.toggle()}
                />
                {clipSelected && <span className="pointer-events-none absolute inset-0 rounded-[12px] ring-2 ring-rec ring-inset" />}
                {safeZones && <SafeZones />}
                {original && (
                  <span className="pointer-events-none absolute top-3 left-3 rounded-full bg-black/60 px-2.5 py-1 text-[11px] font-medium text-white">
                    Original
                  </span>
                )}
              </div>
            </ContextMenuTrigger>
            <PreviewMenu />
          </ContextMenu>
        </div>
      </div>
      <Transport />
    </div>
  );
}

function PreviewMenu() {
  const hasStyle = useUiStore((s) => !!s.styleClipboard);
  const target = () => clipAtPlayhead()?.id;
  return (
    <ContextMenuContent className="w-52">
      <ContextMenuItem onSelect={splitAtPlayhead}>
        <Scissors /> Split here
        <ContextMenuShortcut>S</ContextMenuShortcut>
      </ContextMenuItem>
      <ContextMenuItem onSelect={() => duplicateClip(target())}>
        <Copy /> Duplicate clip
        <ContextMenuShortcut>{keyLabel("mod+D")}</ContextMenuShortcut>
      </ContextMenuItem>
      <ContextMenuSeparator />
      <ContextMenuItem onSelect={() => copyStyle(target())}>
        <Paintbrush /> Copy style
      </ContextMenuItem>
      <ContextMenuItem disabled={!hasStyle} onSelect={() => pasteStyle(target())}>
        <ClipboardPaste /> Paste style
      </ContextMenuItem>
      <ContextMenuSeparator />
      <ContextMenuItem
        variant="destructive"
        onSelect={() => {
          const id = target();
          if (id) deleteClip(id);
        }}
      >
        <Trash2 /> Delete clip
        <ContextMenuShortcut>{keyLabel("delete")}</ContextMenuShortcut>
      </ContextMenuItem>
    </ContextMenuContent>
  );
}

const ZOOMS: { value: PreviewZoom; label: string }[] = [
  { value: "fit", label: "Fit" },
  { value: 0.5, label: "50%" },
  { value: 1, label: "100%" },
];

/** Player controls under the canvas. */
function Transport() {
  const { original, playing, currentMs, previewZoom, setPreviewZoom } = useUiStore();
  const fps = usePlanStore((s) => s.plan.canvas.fps);
  const totalMs = useTimeline().durationMs;
  const frameMs = 1000 / fps;
  const [zoomOpen, setZoomOpen] = useState(false);

  return (
    <div className="flex h-10 w-full max-w-[560px] shrink-0 items-center gap-1">
      <div className="flex flex-1 items-center gap-1">
        <span className="font-mono text-xs text-ink tabular-nums" data-time>
          {formatTime(currentMs, true)}
        </span>
        <span className="font-mono text-xs text-muted-foreground tabular-nums" data-total={Math.round(totalMs)}>
          / {formatTime(totalMs, true)}
        </span>
      </div>

      <IconButton label="Back to start" shortcut="Home" onClick={() => playerControls.seekOutputMs(0)}>
        <SkipBack className="size-4" />
      </IconButton>
      <IconButton label="Previous frame" shortcut="," onClick={() => playerControls.nudge(-frameMs)}>
        <StepBack className="size-4" />
      </IconButton>
      <button
        onClick={() => playerControls.toggle()}
        className="mx-1 grid size-9 place-items-center rounded-full bg-ink text-white hover:bg-ink-2 focus-visible:ring-2 focus-visible:ring-rec/40 focus-visible:outline-none"
        aria-label={playing ? "Pause" : "Play"}
      >
        {playing ? <Pause className="size-4" fill="currentColor" /> : <Play className="size-4 translate-x-px" fill="currentColor" />}
      </button>
      <IconButton label="Next frame" shortcut="." onClick={() => playerControls.nudge(frameMs)}>
        <StepForward className="size-4" />
      </IconButton>
      <IconButton label="Split at playhead" shortcut="S" onClick={splitAtPlayhead}>
        <Scissors className="size-4" />
      </IconButton>

      <div className="flex flex-1 items-center justify-end gap-1">
        <Popover open={zoomOpen} onOpenChange={setZoomOpen}>
          <PopoverTrigger asChild>
            <button
              aria-label="Preview zoom"
              className="flex h-8 items-center gap-0.5 rounded-[10px] px-2 font-mono text-xs text-ink-2 hover:bg-surface hover:text-ink"
            >
              {ZOOMS.find((z) => z.value === previewZoom)?.label}
              <ChevronDown className="size-3.5" />
            </button>
          </PopoverTrigger>
          <PopoverContent align="end" className="w-28 p-1">
            {ZOOMS.map((z) => (
              <button
                key={z.label}
                onClick={() => {
                  setPreviewZoom(z.value);
                  setZoomOpen(false);
                }}
                className={cn(
                  "flex h-8 w-full items-center rounded-[8px] px-2 text-[13px] hover:bg-surface",
                  previewZoom === z.value && "font-medium text-ink",
                )}
              >
                {z.label}
              </button>
            ))}
          </PopoverContent>
        </Popover>
        <div className="inline-flex rounded-[10px] bg-surface p-0.5 text-xs" role="group" aria-label="Preview mode">
          {[
            { v: false, l: "Edited" },
            { v: true, l: "Original" },
          ].map((o) => (
            <button
              key={o.l}
              onClick={() => original !== o.v && toggleOriginal()}
              aria-pressed={original === o.v}
              className={cn(
                "h-7 rounded-[8px] px-2.5",
                original === o.v ? "bg-white font-medium text-ink shadow-[0_0_0_1px_var(--border)]" : "text-muted-foreground hover:text-ink",
              )}
            >
              {o.l}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

/** Largest width × height with the canvas aspect ratio that fits inside the element. */
function useFitSize(ref: React.RefObject<HTMLDivElement | null>, width: number, height: number) {
  const [size, setSize] = useState<{ w: number; h: number } | null>(null);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const measure = () => {
      const { width: bw, height: bh } = el.getBoundingClientRect();
      if (bw <= 0 || bh <= 0) return setSize(null);
      const scale = Math.min(bw / width, bh / height);
      const next = { w: Math.floor(width * scale), h: Math.floor(height * scale) };
      setSize((prev) => (prev && prev.w === next.w && prev.h === next.h ? prev : next));
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [ref, width, height]);
  return size;
}

// Areas covered by TikTok/Reels UI: top bar, right action column, bottom caption area.
function SafeZones() {
  return (
    <div className="pointer-events-none absolute inset-0">
      <div className="absolute inset-x-0 top-0 h-[9%] bg-rec/25" />
      <div className="absolute top-[30%] right-0 bottom-[20%] w-[15%] bg-rec/25" />
      <div className="absolute inset-x-0 bottom-0 h-[20%] bg-rec/25" />
      <span className="absolute bottom-[21%] left-2 rounded bg-black/60 px-1.5 py-0.5 text-[10px] text-white">
        Keep captions out of the orange areas
      </span>
    </div>
  );
}
