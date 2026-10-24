"use client";

import { useState } from "react";
import { Copy, Gauge, Magnet, Minus, Plus, Scissors, Trash2 } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Slider } from "@/components/ui/slider";
import { deleteSelection, duplicateSelection, setClipSpeed, splitSelectionAtPlayhead, targetClip } from "@/lib/editor/actions";
import { usePlanStore, useUiStore } from "@/lib/editor/store";
import { formatTimecode, ppsToSlider, sliderToPps, timelineZoom, useTimelineView } from "@/lib/editor/timeline-view";
import { cn } from "@/lib/utils";
import { IconButton } from "../controls";
import { SPEEDS } from "./menus";
import { TOOLBAR_H } from "./model";

const ICON = "size-4";

function Divider() {
  return <span className="mx-1 h-4 w-px shrink-0 bg-line" aria-hidden />;
}

function SpeedButton() {
  const [open, setOpen] = useState(false);
  const plan = usePlanStore((s) => s.plan);
  const selected = useUiStore((s) => s.selected);
  useUiStore((s) => s.currentMs);
  const sel = plan.clips.filter((c) => selected.some((s) => s.kind === "clip" && s.id === c.id));
  const speed = sel.length ? (sel.every((c) => c.speed === sel[0].speed) ? sel[0].speed : null) : targetClip(plan).speed;
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label="Clip speed"
          title="Clip speed"
          className="flex h-8 items-center gap-1 rounded-[10px] px-2 text-xs text-ink-2 hover:bg-surface hover:text-ink aria-expanded:bg-surface"
        >
          <Gauge className={ICON} />
          <span className="font-mono tabular-nums">{speed === null ? "Mixed" : `${speed}×`}</span>
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-44 rounded-[12px] p-1">
        <p className="px-2 pt-1.5 pb-1 text-[11px] text-muted-foreground">{sel.length > 1 ? `${sel.length} clips` : "Clip speed"}</p>
        <div className="grid grid-cols-3 gap-0.5" role="group" aria-label="Speed">
          {SPEEDS.map((s) => (
            <button
              key={s}
              type="button"
              aria-pressed={speed === s}
              onClick={() => {
                setClipSpeed(s);
                setOpen(false);
              }}
              className={cn("h-8 rounded-[8px] font-mono text-xs", speed === s ? "bg-ink text-white" : "hover:bg-surface")}
            >
              {s}×
            </button>
          ))}
        </div>
      </PopoverContent>
    </Popover>
  );
}

export function TimelineToolbar({ durationMs }: { durationMs: number }) {
  const { snap, toggleSnap, pps, livePps, setPps } = useTimelineView();
  const hasSelection = useUiStore((s) => s.selected.length > 0);
  const currentMs = useUiStore((s) => s.currentMs);
  const fps = usePlanStore((s) => s.plan.canvas.fps);
  const zoom = pps ?? livePps;

  return (
    <div className="flex shrink-0 items-center gap-0.5 border-b bg-white px-2" style={{ height: TOOLBAR_H }} role="toolbar" aria-label="Timeline tools">
      <IconButton label="Split" shortcut="S" onClick={splitSelectionAtPlayhead}>
        <Scissors className={ICON} />
      </IconButton>
      <IconButton label="Delete" shortcut="delete" disabled={!hasSelection} onClick={() => deleteSelection()}>
        <Trash2 className={ICON} />
      </IconButton>
      <IconButton label="Duplicate" shortcut="mod+D" onClick={duplicateSelection}>
        <Copy className={ICON} />
      </IconButton>
      <SpeedButton />
      <Divider />
      <IconButton label={snap ? "Snapping on" : "Snapping off"} shortcut="N" pressed={snap} onClick={toggleSnap}>
        <Magnet className={cn(ICON, snap && "text-ink")} />
      </IconButton>

      <div className="ml-auto flex items-center gap-0.5">
        <span className="mr-2 font-mono text-xs text-ink tabular-nums" data-tl-time title="Playhead (m:ss:frames)">
          {formatTimecode(currentMs, fps)}
          <span className="text-muted-foreground"> / {formatTimecode(durationMs, fps)}</span>
        </span>
        <Divider />
        <IconButton label="Zoom out" shortcut="-" onClick={() => timelineZoom.step(-1)}>
          <Minus className={ICON} />
        </IconButton>
        <Slider
          aria-label="Timeline zoom"
          className="w-28"
          value={[Math.round(ppsToSlider(zoom) * 1000)]}
          min={0}
          max={1000}
          step={1}
          onValueChange={([v]) => setPps(sliderToPps(v / 1000))}
        />
        <IconButton label="Zoom in" shortcut="=" onClick={() => timelineZoom.step(1)}>
          <Plus className={ICON} />
        </IconButton>
        <button
          type="button"
          aria-label="Zoom to fit"
          aria-pressed={pps === null}
          title="Fit the whole video (Shift+Z)"
          onClick={timelineZoom.fit}
          className={cn(
            "ml-0.5 h-7 rounded-[8px] px-2 text-xs text-ink-2 hover:bg-surface hover:text-ink",
            pps === null && "bg-surface font-medium text-ink",
          )}
        >
          Fit
        </button>
      </div>
    </div>
  );
}
