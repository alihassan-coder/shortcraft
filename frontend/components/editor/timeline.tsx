"use client";

import { useMemo, useRef, useState } from "react";
import { PencilLine, Trash2 } from "lucide-react";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuShortcut,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import { trackById } from "@/lib/edit-plan/music-library";
import { activeCuts, isWordCut } from "@/lib/edit-plan/timeline";
import { keyLabel, textItems } from "@/lib/editor/actions";
import { revealPanel } from "@/lib/editor/layout";
import { playerControls } from "@/lib/editor/player";
import { dispatch, usePlanStore, useSelectedId, useTimeline, useUiStore } from "@/lib/editor/store";
import { cn } from "@/lib/utils";
import { TextContextMenu } from "./assets";

const CUT_TINT = {
  silence: "bg-[repeating-linear-gradient(135deg,rgba(240,68,56,.22)_0_4px,rgba(240,68,56,.08)_4px_8px)]",
  filler: "bg-cut/25",
  retake: "bg-[repeating-linear-gradient(135deg,rgba(240,68,56,.3)_0_6px,rgba(240,68,56,.12)_6px_12px)]",
  manual: "bg-cut/35",
} as const;

// Timeline in SOURCE time so you can see what was cut and where.
export function Timeline() {
  const plan = usePlanStore((s) => s.plan);
  const { currentMs, selectZoom, select } = useUiStore();
  const selectedZoomId = useSelectedId("zoom");
  const selectedClipId = useSelectedId("clip");
  const selectedTextId = useSelectedId("text");
  const tl = useTimeline();
  // Source-time view of the first (only) source; E4 replaces this with the multi-track timeline.
  const source = plan.sources[0];
  const duration = source.durationMs;
  const playheadMs = tl.toSource(currentMs)?.srcMs ?? 0;
  const pieces = useMemo(() => tl.pieces.filter((p) => p.sourceId === source.id), [tl, source.id]);
  const area = useRef<HTMLDivElement>(null);
  const [drag, setDrag] = useState<{ id: string; dx: number } | null>(null);

  const pct = (ms: number) => `${(ms / duration) * 100}%`;
  const msFromEvent = (clientX: number) => {
    const box = area.current!.getBoundingClientRect();
    return Math.min(duration, Math.max(0, ((clientX - box.left) / box.width) * duration));
  };

  const seconds = Array.from({ length: Math.floor(duration / 1000) + 1 }, (_, i) => i);
  const track = trackById(plan.music.trackId);
  // Text lives in output time; place it at the source moment it starts on (approximate until E4).
  const texts = textItems(plan).map((t) => {
    const s0 = tl.toSource(t.startMs)?.srcMs ?? 0;
    const s1 = tl.toSource(Math.max(t.startMs, t.endMs - 1))?.srcMs ?? s0;
    return { t, start: s0, end: Math.max(s0 + 200, s1) };
  });

  return (
    <div className="flex h-full flex-col px-5 py-3 select-none">
      <div className="grid min-h-0 grid-cols-[72px_1fr] gap-x-3">
        <div className="space-y-2 pt-6 text-[11px] text-muted-foreground">
          <p className="h-5 leading-5">Text</p>
          <p className="h-8 leading-8">Video</p>
          <p className="h-5 leading-5">Captions</p>
          <p className="h-6 leading-6">Zoom</p>
          <p className="h-5 leading-5">Music</p>
        </div>

        <div
          ref={area}
          className="relative cursor-pointer"
          onPointerDown={(e) => {
            if (e.button !== 0) return;
            const el = e.target as HTMLElement;
            if (el.closest("[data-zoom], [data-text-block]")) return;
            const clipId = el.closest<HTMLElement>("[data-clip]")?.dataset.clip;
            if (clipId) select({ kind: "clip", id: clipId });
            playerControls.seekSourceMs(source.id, msFromEvent(e.clientX));
          }}
        >
          {/* Ruler */}
          <div className="relative h-5 border-b">
            {seconds.map((s) => (
              <span key={s} className="absolute top-0 h-full border-l border-line" style={{ left: pct(s * 1000) }}>
                {s % 2 === 0 && <span className="ml-1 font-mono text-[10px] text-muted-foreground">{s}s</span>}
              </span>
            ))}
          </div>

          <div className="mt-1 space-y-2">
            {/* Text lane */}
            <div className="relative h-5 rounded-md bg-surface">
              {texts.map(({ t, start, end }) => (
                <TextContextMenu
                  key={t.id}
                  textId={t.id}
                  onEdit={() => {
                    select({ kind: "text", id: t.id });
                    revealPanel("inspector");
                  }}
                >
                  <button
                    data-text-block={t.id}
                    onClick={() => {
                      select({ kind: "text", id: t.id });
                      playerControls.seekOutputMs(t.startMs);
                    }}
                    className={cn(
                      "absolute top-0.5 h-4 truncate rounded-[4px] px-1.5 text-left text-[10px] leading-4 font-medium",
                      t.id === selectedTextId ? "bg-ink text-white ring-2 ring-rec" : "bg-white text-ink ring-1 ring-line hover:ring-ink/30",
                    )}
                    style={{ left: pct(start), width: pct(end - start) }}
                  >
                    {t.text}
                  </button>
                </TextContextMenu>
              ))}
            </div>

            {/* Video lane */}
            <div className="relative h-8 overflow-hidden rounded-md bg-[#e8e8ed]">
              {pieces.map((s) => (
                <span
                  key={s.key}
                  data-clip={s.clipId}
                  className={cn(
                    "absolute inset-y-0 rounded-[5px] border border-ink/10 bg-[length:auto_100%] bg-repeat-x opacity-90",
                    s.clipId === selectedClipId && "z-10 border-rec ring-2 ring-rec ring-inset",
                  )}
                  style={{
                    left: pct(s.srcStart),
                    width: pct(s.srcEnd - s.srcStart),
                    backgroundImage: source.poster ? `url(${source.poster})` : undefined,
                  }}
                />
              ))}
              {activeCuts(plan, source.id).map((c) => (
                <span
                  key={c.id}
                  title={c.note ?? c.reason}
                  className={cn("absolute inset-y-0 border-x border-cut/50", CUT_TINT[c.reason])}
                  style={{ left: pct(c.startMs), width: pct(c.endMs - c.startMs) }}
                />
              ))}
            </div>

            {/* Captions lane */}
            <div className="relative h-5 rounded-md bg-surface">
              {plan.captions.enabled &&
                source.words
                  .filter((w) => !isWordCut(plan, source.id, w))
                  .map((w) => (
                    <span
                      key={w.id}
                      className={cn(
                        "absolute top-1 h-3 rounded-[3px]",
                        plan.captions.highlights.includes(w.id) ? "bg-caption" : "bg-ink/25",
                      )}
                      style={{ left: pct(w.startMs), width: `calc(${pct(w.endMs - w.startMs)} - 1px)` }}
                    />
                  ))}
            </div>

            {/* Zoom lane */}
            <div className="relative h-6 rounded-md bg-surface">
              {plan.zooms.enabled &&
                plan.zooms.items.map((z) => {
                  const offset = drag?.id === z.id ? drag.dx : 0;
                  return (
                    <ContextMenu key={z.id} onOpenChange={(open) => open && selectZoom(z.id)}>
                      <ContextMenuTrigger asChild>
                    <button
                      data-zoom={z.id}
                      onPointerDown={(e) => {
                        if (e.button !== 0) return;
                        e.currentTarget.setPointerCapture(e.pointerId);
                        selectZoom(z.id);
                        setDrag({ id: z.id, dx: 0 });
                        (e.currentTarget as HTMLElement).dataset.x = String(e.clientX);
                      }}
                      onPointerMove={(e) => {
                        if (drag?.id !== z.id) return;
                        const startX = Number((e.currentTarget as HTMLElement).dataset.x);
                        const box = area.current!.getBoundingClientRect();
                        setDrag({ id: z.id, dx: ((e.clientX - startX) / box.width) * duration });
                      }}
                      onPointerUp={() => {
                        if (drag?.id === z.id && Math.abs(drag.dx) > 30) {
                          const len = z.endMs - z.startMs;
                          const start = Math.min(duration - len, Math.max(0, z.startMs + drag.dx));
                          dispatch({ type: "updateZoom", zoomId: z.id, patch: { startMs: start, endMs: start + len } });
                        } else {
                          playerControls.seekSourceMs(z.sourceId, z.startMs);
                        }
                        setDrag(null);
                      }}
                      className={cn(
                        "absolute top-0.5 h-5 cursor-grab rounded-[5px] px-1.5 text-left text-[10px] font-medium text-white active:cursor-grabbing",
                        z.id === selectedZoomId ? "bg-rec ring-2 ring-rec/30" : "bg-ink hover:bg-ink-2",
                      )}
                      style={{ left: pct(z.startMs + offset), width: pct(z.endMs - z.startMs) }}
                      aria-label={`Zoom at ${(z.startMs / 1000).toFixed(1)} seconds`}
                    >
                      <span className="truncate">{Math.round(z.scale * 100)}%</span>
                    </button>
                      </ContextMenuTrigger>
                      <ContextMenuContent className="w-44">
                        <ContextMenuItem
                          onSelect={() => {
                            selectZoom(z.id);
                            revealPanel("inspector");
                          }}
                        >
                          <PencilLine /> Edit
                        </ContextMenuItem>
                        <ContextMenuSeparator />
                        <ContextMenuItem
                          variant="destructive"
                          onSelect={() => {
                            dispatch({ type: "removeZoom", zoomId: z.id });
                            selectZoom(null);
                          }}
                        >
                          <Trash2 /> Delete
                          <ContextMenuShortcut>{keyLabel("delete")}</ContextMenuShortcut>
                        </ContextMenuItem>
                      </ContextMenuContent>
                    </ContextMenu>
                  );
                })}
            </div>

            {/* Music lane */}
            <div className="relative h-5 overflow-hidden rounded-md bg-surface">
              {track && (
                <span className="absolute inset-y-0.5 left-0 right-0 flex items-center rounded-[4px] bg-rec/15 px-2 text-[10px] text-rec">
                  {track.name}
                  {plan.music.ducking && " · lowers under voice"}
                </span>
              )}
            </div>
          </div>

          {/* Playhead */}
          <div className="pointer-events-none absolute top-0 bottom-0 w-px bg-rec" style={{ left: pct(playheadMs) }}>
            <span className="absolute -top-1 -left-[5px] size-[11px] rounded-full border-2 border-white bg-rec" />
          </div>
        </div>
      </div>
    </div>
  );
}
