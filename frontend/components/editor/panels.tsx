"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Check, Pause, Play, Plus, RotateCcw, Scissors, Trash2, X } from "lucide-react";
import { CAPTION_PRESETS, captionTextStyle } from "@/lib/caption-presets";
import type { EditPlan, ZoomStyle } from "@/lib/edit-plan/schema";
import { TRACKS } from "@/lib/edit-plan/music-library";
import type { EditCommand } from "@/lib/edit-plan/commands";
import { formatTime, isCutActive } from "@/lib/edit-plan/timeline";
import { playerControls } from "@/lib/editor/player";
import { dispatch, usePlanStore, useTimeline, useUiStore, type Tool } from "@/lib/editor/store";
import { cn } from "@/lib/utils";
import { Group, PanelHeader, Segmented, SliderRow, ToggleRow } from "./controls";

const usePlan = () => usePlanStore((s) => s.plan);

/* ---------- Style ---------- */

const VIBES: { value: EditPlan["vibe"]; label: string }[] = [
  { value: "energetic", label: "Energetic" },
  { value: "clean", label: "Clean" },
  { value: "story", label: "Story" },
];

function StylePanel() {
  const plan = usePlan();
  return (
    <>
      <PanelHeader title="Style" description="Pick a vibe for the whole video, then a caption look." />
      <Group label="Vibe">
        <Segmented
          value={plan.vibe}
          options={VIBES.map((v) => ({ value: v.value, label: v.label }))}
          onChange={(vibe) => dispatch({ type: "setVibe", vibe })}
        />
      </Group>
      <Group label="Caption style">
        <div className="grid grid-cols-2 gap-2">
          {CAPTION_PRESETS.map((preset) => {
            const active = preset.id === plan.captions.presetId;
            return (
              <button
                key={preset.id}
                onClick={() => dispatch({ type: "setCaptions", captions: { presetId: preset.id } })}
                aria-pressed={active}
                className={cn(
                  "rounded-xl p-1 text-left ring-2 transition",
                  active ? "ring-ink" : "ring-transparent hover:ring-line",
                )}
              >
                <span className="grid h-14 place-items-center rounded-lg bg-[#2a2a2e] text-[14px]">
                  <span className="flex gap-[0.3em]">
                    <span style={captionTextStyle(preset, false)}>Watch</span>
                    <span style={captionTextStyle(preset, true)}>this</span>
                  </span>
                </span>
                <span className="mt-1.5 flex items-center justify-between px-1 text-xs">
                  {preset.name}
                  {active && <Check className="size-3.5" />}
                </span>
              </button>
            );
          })}
        </div>
      </Group>
    </>
  );
}

/* ---------- Captions ---------- */

function CaptionsPanel() {
  const plan = usePlan();
  const { captions } = plan;
  const wordsById = useMemo(() => new Map(plan.sources.flatMap((src) => src.words).map((w) => [w.id, w])), [plan.sources]);

  return (
    <>
      <PanelHeader
        title="Captions"
        description="Click any word in the transcript to highlight it, add an emoji or fix the spelling."
      />
      <Group>
        <ToggleRow label="Show captions" checked={captions.enabled} onChange={(v) => dispatch({ type: "setCaptions", captions: { enabled: v } })} />
        <ToggleRow label="Emojis" checked={captions.showEmojis} onChange={(v) => dispatch({ type: "setCaptions", captions: { showEmojis: v } })} />
      </Group>
      <Group label="Layout">
        <p className="mb-2 text-sm">Words per line</p>
        <Segmented
          value={captions.wordsPerLine}
          options={[
            { value: 1, label: "1" },
            { value: 2, label: "2" },
            { value: 3, label: "3" },
          ]}
          onChange={(v) => dispatch({ type: "setCaptions", captions: { wordsPerLine: v } })}
        />
        <div className="mt-4 space-y-2">
          <SliderRow label="Size" value={captions.size} min={40} max={140} onChange={(v) => dispatch({ type: "setCaptions", captions: { size: v } })} />
          <SliderRow
            label="Position"
            value={Math.round(captions.positionY * 100)}
            min={15}
            max={90}
            format={(v) => (v < 40 ? "Top" : v < 62 ? "Middle" : "Lower")}
            onChange={(v) => dispatch({ type: "setCaptions", captions: { positionY: v / 100 } })}
          />
        </div>
        <button
          onClick={() => useUiStore.getState().setSafeZones(!useUiStore.getState().safeZones)}
          className="mt-3 text-xs text-muted-foreground underline underline-offset-2 hover:text-ink"
        >
          Show / hide app safe zones
        </button>
      </Group>
      <Group label={`Highlighted words (${captions.highlights.length})`}>
        <div className="flex flex-wrap gap-1.5">
          {captions.highlights.map((id) => (
            <button
              key={id}
              onClick={() => dispatch({ type: "toggleHighlight", wordId: id })}
              className="group flex items-center gap-1 rounded-full bg-surface px-2.5 py-1 text-xs hover:bg-[#ebebef]"
            >
              {captions.emojis[id] && <span>{captions.emojis[id]}</span>}
              {captions.edits[id] ?? wordsById.get(id)?.text}
              <X className="size-3 text-muted-foreground group-hover:text-ink" />
            </button>
          ))}
          {!captions.highlights.length && <p className="text-xs text-muted-foreground">No highlighted words yet.</p>}
        </div>
      </Group>
    </>
  );
}

/* ---------- Cuts ---------- */

const REASON_LABEL = { silence: "Pause", filler: "Filler word", retake: "Repeated take", manual: "Removed by you" } as const;

function CutsPanel() {
  const plan = usePlan();
  const tl = useTimeline({ original: false });
  const sourceMs = plan.clips.reduce((sum, c) => sum + (c.outMs - c.inMs) / c.speed, 0);
  const saved = Math.max(0, sourceMs - tl.durationMs);
  const wordsOf = (sourceId: string) => plan.sources.find((s) => s.id === sourceId)?.words ?? [];
  const count = (r: "silence" | "filler" | "retake") => plan.cuts.items.filter((c) => c.reason === r).length;
  const textFor = (sourceId: string, start: number, end: number) =>
    wordsOf(sourceId)
      .filter((w) => w.startMs >= start - 10 && w.endMs <= end + 10)
      .map((w) => w.text)
      .join(" ");

  return (
    <>
      <PanelHeader title="Cuts" description="Choose what gets removed. Every cut can be brought back." />
      <Group>
        <div className="mb-3 flex items-baseline justify-between rounded-xl bg-surface px-3.5 py-3">
          <span className="text-sm">Time saved</span>
          <span className="font-mono text-sm">
            {(saved / 1000).toFixed(1)}s · <span className="text-muted-foreground line-through">{formatTime(sourceMs)}</span>{" "}
            {formatTime(tl.durationMs)}
          </span>
        </div>
        <ToggleRow label="Long pauses" hint={`${count("silence")} found`} checked={plan.cuts.silence} onChange={(v) => dispatch({ type: "setCutRules", rules: { silence: v } })} />
        <ToggleRow label="Filler words" hint={`${count("filler")} found: um, uh, like`} checked={plan.cuts.filler} onChange={(v) => dispatch({ type: "setCutRules", rules: { filler: v } })} />
        <ToggleRow label="Repeated takes" hint={`${count("retake")} found, kept the better take`} checked={plan.cuts.retake} onChange={(v) => dispatch({ type: "setCutRules", rules: { retake: v } })} />
      </Group>
      <Group label="All cuts">
        <ul className="-mx-2 space-y-0.5">
          {plan.cuts.items
            .slice()
            .sort((a, b) => a.startMs - b.startMs)
            .map((c) => {
              const active = isCutActive(plan, c);
              const text = textFor(c.sourceId, c.startMs, c.endMs);
              return (
                <li key={c.id} className="group flex items-center gap-2 rounded-lg px-2 py-2 hover:bg-surface">
                  <button onClick={() => playerControls.seekSourceMs(c.sourceId, c.startMs)} className="min-w-0 flex-1 text-left">
                    <span className={cn("block truncate text-[13px]", !active && "text-muted-foreground")}>
                      {text ? `“${text}”` : `${((c.endMs - c.startMs) / 1000).toFixed(1)}s of silence`}
                    </span>
                    <span className="block text-[11px] text-muted-foreground">
                      {REASON_LABEL[c.reason]} · {formatTime(c.startMs, true)}
                    </span>
                  </button>
                  {c.reason === "manual" ? (
                    <button
                      onClick={() => dispatch({ type: "removeCut", cutId: c.id })}
                      className="rounded-md p-1.5 text-muted-foreground hover:bg-white hover:text-ink"
                      aria-label="Restore"
                    >
                      <RotateCcw className="size-3.5" />
                    </button>
                  ) : (
                    <button
                      disabled={!plan.cuts[c.reason]}
                      onClick={() => dispatch({ type: "toggleRestoreCut", cutId: c.id })}
                      className="rounded-md p-1.5 text-muted-foreground hover:bg-white hover:text-ink disabled:opacity-30"
                      aria-label={active ? "Restore" : "Cut again"}
                    >
                      {active ? <RotateCcw className="size-3.5" /> : <Scissors className="size-3.5" />}
                    </button>
                  )}
                </li>
              );
            })}
        </ul>
      </Group>
    </>
  );
}

/* ---------- Zoom ---------- */

const ZOOM_STYLES: { value: ZoomStyle; label: string }[] = [
  { value: "punch", label: "Punch" },
  { value: "smooth", label: "Smooth" },
  { value: "push", label: "Push" },
  { value: "linear", label: "Linear" },
];

function ZoomPanel() {
  const plan = usePlan();
  const { selectedZoomId, selectZoom, currentMs } = useUiStore();
  const selected = plan.zooms.items.find((z) => z.id === selectedZoomId);
  const tl = useTimeline({ original: false });
  const updateZoom = (zoomId: string, patch: Extract<EditCommand, { type: "updateZoom" }>["patch"]) =>
    dispatch({ type: "updateZoom", zoomId, patch });

  return (
    <>
      <PanelHeader title="Zoom-ins" description="Punch in on the moments that matter. Click a zoom on the timeline to edit it." />
      <Group>
        <ToggleRow label="Zoom-ins" checked={plan.zooms.enabled} onChange={(enabled) => dispatch({ type: "setZoomsEnabled", enabled })} />
        <button
          onClick={() => {
            const at = tl.toSource(currentMs);
            if (at) dispatch({ type: "addZoom", sourceId: at.sourceId, atMs: at.srcMs });
          }}
          className="mt-2 flex h-9 w-full items-center justify-center gap-1.5 rounded-full border text-sm hover:bg-surface"
        >
          <Plus className="size-4" /> Add zoom at playhead
        </button>
      </Group>
      <Group label={`Zooms (${plan.zooms.items.length})`}>
        <ul className="-mx-2 space-y-0.5">
          {plan.zooms.items.map((z, i) => (
            <li key={z.id}>
              <button
                onClick={() => {
                  selectZoom(z.id);
                  playerControls.seekSourceMs(z.sourceId, z.startMs);
                }}
                className={cn(
                  "flex w-full items-center gap-3 rounded-lg px-2 py-2 text-left text-[13px]",
                  z.id === selectedZoomId ? "bg-surface" : "hover:bg-surface",
                )}
              >
                <span className="grid size-6 place-items-center rounded-md bg-ink text-[11px] text-white">{i + 1}</span>
                <span className="flex-1">
                  {ZOOM_STYLES.find((s) => s.value === z.style)?.label} · {Math.round(z.scale * 100)}%
                </span>
                <span className="font-mono text-[11px] text-muted-foreground">{formatTime(z.startMs, true)}</span>
              </button>
            </li>
          ))}
        </ul>
      </Group>
      {selected && (
        <Group label="Selected zoom">
          <Segmented value={selected.style} options={ZOOM_STYLES} onChange={(style) => updateZoom(selected.id, { style })} />
          <div className="mt-4 space-y-2">
            <SliderRow
              label="Strength"
              value={Math.round(selected.scale * 100)}
              min={105}
              max={160}
              format={(v) => `${v}%`}
              onChange={(v) => updateZoom(selected.id, { scale: v / 100 })}
            />
            <SliderRow
              label="Length"
              value={Math.round((selected.endMs - selected.startMs) / 100) / 10}
              min={0.5}
              max={5}
              step={0.1}
              format={(v) => `${v.toFixed(1)}s`}
              onChange={(v) => updateZoom(selected.id, { endMs: selected.startMs + v * 1000 })}
            />
            <SliderRow
              label="Focus height"
              value={Math.round(selected.focusY * 100)}
              min={10}
              max={90}
              format={(v) => `${v}%`}
              onChange={(v) => updateZoom(selected.id, { focusY: v / 100 })}
            />
          </div>
          <button
            onClick={() => {
              dispatch({ type: "removeZoom", zoomId: selected.id });
              selectZoom(null);
            }}
            className="mt-3 flex items-center gap-1.5 text-sm text-cut hover:underline"
          >
            <Trash2 className="size-3.5" /> Delete zoom
          </button>
        </Group>
      )}
    </>
  );
}

/* ---------- Audio ---------- */

function AudioPanel() {
  const plan = usePlan();
  const { music } = plan;
  const [previewing, setPreviewing] = useState<string | null>(null);
  const audio = useRef<HTMLAudioElement | null>(null);

  useEffect(() => () => audio.current?.pause(), []);

  const preview = (src: string, id: string) => {
    if (previewing === id) {
      audio.current?.pause();
      setPreviewing(null);
      return;
    }
    audio.current?.pause();
    audio.current = new Audio(src);
    audio.current.volume = 0.6;
    audio.current.play().catch(() => setPreviewing(null));
    audio.current.onended = () => setPreviewing(null);
    setPreviewing(id);
  };

  return (
    <>
      <PanelHeader title="Audio" description="Clean up your voice and add music that steps back when you talk." />
      <Group>
        <ToggleRow
          label="Studio voice"
          hint="Removes background noise and echo"
          checked={plan.voice.enhance}
          onChange={(enhance) => dispatch({ type: "setVoice", voice: { enhance } })}
        />
      </Group>
      <Group label="Music">
        <ul className="-mx-2 space-y-0.5">
          <li>
            <button
              onClick={() => dispatch({ type: "setMusic", music: { trackId: null } })}
              className={cn("flex w-full items-center gap-3 rounded-lg px-2 py-2 text-left text-sm", music.trackId === null ? "bg-surface" : "hover:bg-surface")}
            >
              <span className="grid size-8 place-items-center rounded-full border">
                <X className="size-3.5" />
              </span>
              <span className="flex-1">No music</span>
              {music.trackId === null && <Check className="size-4" />}
            </button>
          </li>
          {TRACKS.map((t) => (
            <li key={t.id} className={cn("flex items-center gap-3 rounded-lg px-2 py-2", music.trackId === t.id ? "bg-surface" : "hover:bg-surface")}>
              <button
                onClick={() => preview(t.src, t.id)}
                className={cn("grid size-8 place-items-center rounded-full", previewing === t.id ? "bg-ink text-white" : "border bg-white")}
                aria-label={previewing === t.id ? `Stop ${t.name}` : `Preview ${t.name}`}
              >
                {previewing === t.id ? <Pause className="size-3.5" /> : <Play className="size-3.5" />}
              </button>
              <button onClick={() => dispatch({ type: "setMusic", music: { trackId: t.id } })} className="flex flex-1 items-center text-left">
                <span className="flex-1">
                  <span className="block text-sm">{t.name}</span>
                  <span className="block text-[11px] text-muted-foreground">{t.mood}</span>
                </span>
                {music.trackId === t.id && <Check className="size-4" />}
              </button>
            </li>
          ))}
        </ul>
      </Group>
      {music.trackId && (
        <Group label="Mix">
          <SliderRow label="Music volume" value={Math.round(music.volume * 100)} min={0} max={100} format={(v) => `${v}%`} onChange={(v) => dispatch({ type: "setMusic", music: { volume: v / 100 } })} />
          <ToggleRow label="Lower music while I talk" checked={music.ducking} onChange={(ducking) => dispatch({ type: "setMusic", music: { ducking } })} />
          {music.ducking && (
            <SliderRow label="Volume while talking" value={Math.round(music.duckTo * 100)} min={0} max={100} format={(v) => `${v}%`} onChange={(v) => dispatch({ type: "setMusic", music: { duckTo: v / 100 } })} />
          )}
          <SliderRow label="Fade out" value={music.fadeOutMs / 1000} min={0} max={4} step={0.1} format={(v) => `${v.toFixed(1)}s`} onChange={(v) => dispatch({ type: "setMusic", music: { fadeOutMs: v * 1000 } })} />
        </Group>
      )}
    </>
  );
}

/* ---------- Hook ---------- */

function HookPanel() {
  const plan = usePlan();
  const { hook } = plan;
  return (
    <>
      <PanelHeader title="Hook title" description="A short line in the first seconds that makes people stop scrolling." />
      <Group>
        <ToggleRow label="Show hook title" checked={hook.enabled} onChange={(enabled) => dispatch({ type: "setHook", hook: { enabled } })} />
      </Group>
      <Group label="Suggestions">
        <div className="space-y-1.5">
          {hook.options.map((o) => (
            <button
              key={o}
              onClick={() => {
                dispatch({ type: "setHook", hook: { text: o, enabled: true } });
                playerControls.seekOutputMs(300);
              }}
              className={cn(
                "w-full rounded-xl border px-3.5 py-3 text-left text-sm transition",
                hook.text === o ? "border-ink bg-white" : "hover:bg-surface",
              )}
            >
              {o}
            </button>
          ))}
        </div>
      </Group>
      <Group label="Your text">
        <textarea
          value={hook.text}
          onChange={(e) => dispatch({ type: "setHook", hook: { text: e.target.value } })}
          rows={3}
          maxLength={80}
          className="w-full resize-none rounded-xl border px-3 py-2.5 text-sm outline-none focus:border-ink focus:ring-3 focus:ring-rec/20"
        />
        <p className="mt-1 text-right text-[11px] text-muted-foreground">{hook.text.length}/80</p>
        <SliderRow label="Show for" value={hook.durationMs / 1000} min={1} max={5} step={0.1} format={(v) => `${v.toFixed(1)}s`} onChange={(v) => dispatch({ type: "setHook", hook: { durationMs: v * 1000 } })} />
      </Group>
    </>
  );
}

const PANELS: Record<Tool, () => React.JSX.Element> = {
  style: StylePanel,
  captions: CaptionsPanel,
  cuts: CutsPanel,
  zoom: ZoomPanel,
  music: AudioPanel,
  hook: HookPanel,
};

export function ToolPanel() {
  const tool = useUiStore((s) => s.tool);
  const Panel = PANELS[tool];
  return <Panel />;
}
