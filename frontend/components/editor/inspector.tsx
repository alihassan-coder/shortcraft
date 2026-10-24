"use client";

import { useContext, useState } from "react";
import { HexColorPicker } from "react-colorful";
import {
  AlignCenter,
  AlignLeft,
  AlignRight,
  Copy,
  FlipHorizontal2,
  FlipVertical2,
  Italic,
  Scissors,
  SlidersHorizontal,
  Trash2,
  Volume2,
  VolumeX,
  X,
} from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { CAPTION_PRESETS, captionTextStyle } from "@/lib/caption-presets";
import type { EditCommand } from "@/lib/edit-plan/commands";
import { ASPECT_SIZES, type AnimationType, type Aspect, type Clip, type TextItem, type TextStyle } from "@/lib/edit-plan/schema";
import { FONT_FAMILIES, presetById, presetTextStyle } from "@/lib/edit-plan/text-styles";
import { formatTime, isWordCut } from "@/lib/edit-plan/timeline";
import { deleteClip, deleteSelection, duplicateClip, duplicateText, splitAtPlayhead, textItems } from "@/lib/editor/actions";
import { playerControls } from "@/lib/editor/player";
import { dispatch, usePlanStore, useTimeline, useUiStore } from "@/lib/editor/store";
import { cn } from "@/lib/utils";
import { IconButton, NumberField, PanelHeaderAction, Row, Section, Segmented, SliderRow, ToggleRow } from "./controls";
import { ZOOM_STYLES } from "./panels";
import { WordActions } from "./transcript";

const usePlan = () => usePlanStore((s) => s.plan);
const pct = (v: number) => `${Math.round(v)}%`;
const signed = (v: number) => (v > 0 ? `+${Math.round(v)}` : String(Math.round(v)));

/** The right-hand panel. It shows whatever is selected, or the project when nothing is. */
export function Inspector() {
  const selection = useUiStore((s) => s.selection);
  const plan = usePlan();
  const select = useUiStore((s) => s.select);
  const action = useContext(PanelHeaderAction);

  let body: React.ReactNode = null;
  let title = "Project";
  let subtitle: string | undefined = `${plan.canvas.width}×${plan.canvas.height} · ${plan.canvas.fps} fps`;

  if (selection?.kind === "clip") {
    const i = plan.clips.findIndex((c) => c.id === selection.id);
    if (i >= 0) {
      title = `Clip ${i + 1}`;
      subtitle = `of ${plan.clips.length}`;
      body = <ClipInspector clip={plan.clips[i]} />;
    }
  } else if (selection?.kind === "text") {
    const t = textItems(plan).find((x) => x.id === selection.id);
    if (t) {
      title = "Text";
      subtitle = `${formatTime(t.startMs, true)} – ${formatTime(t.endMs, true)}`;
      body = <TextInspector text={t} />;
    }
  } else if (selection?.kind === "zoom") {
    const z = plan.zooms.items.find((x) => x.id === selection.id);
    if (z) {
      title = "Zoom";
      subtitle = `at ${formatTime(z.startMs, true)} in the source`;
      body = <ZoomInspector zoomId={z.id} />;
    }
  } else if (selection?.kind === "word") {
    const w = plan.sources[0].words.find((x) => x.id === selection.id);
    if (w) {
      title = "Word";
      subtitle = `“${plan.captions.edits[w.id] ?? w.text}” · ${formatTime(w.startMs, true)}`;
      body = <WordInspector wordId={w.id} />;
    }
  }

  const project = !body;
  return (
    <div className="flex h-full min-h-0 flex-col bg-white" data-inspector={project ? "project" : selection?.kind}>
      <div className="flex h-11 shrink-0 items-center gap-2 border-b pr-2 pl-4">
        <div className="min-w-0 flex-1">
          <p className="truncate text-[13px] leading-4 font-semibold">{title}</p>
          {subtitle && <p className="truncate text-[11px] leading-4 text-muted-foreground">{subtitle}</p>}
        </div>
        {!project && (
          <IconButton label="Deselect" shortcut="Escape" onClick={() => select(null)}>
            <X className="size-4" />
          </IconButton>
        )}
        {action}
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto">{body ?? <ProjectInspector />}</div>
    </div>
  );
}

/* ---------- Clip ---------- */

const SPEEDS = [0.5, 0.75, 1, 1.25, 1.5, 2];
const COLOR_PRESETS: { value: Clip["color"]["preset"]; label: string }[] = [
  { value: "none", label: "None" },
  { value: "natural", label: "Natural" },
  { value: "warm", label: "Warm" },
  { value: "cool", label: "Cool" },
  { value: "vivid", label: "Vivid" },
  { value: "mono", label: "Mono" },
  { value: "film", label: "Film" },
];

type ClipPatch = Extract<EditCommand, { type: "updateClip" }>["patch"];

function ClipInspector({ clip }: { clip: Clip }) {
  const update = (patch: ClipPatch) => dispatch({ type: "updateClip", clipId: clip.id, patch });
  const { frame, color } = clip;
  // Length on the edited timeline: speed and cuts both count.
  const lengthMs = useTimeline({ original: false })
    .pieces.filter((p) => p.clipId === clip.id)
    .reduce((sum, p) => sum + p.outEnd - p.outStart, 0);

  return (
    <>
      <div className="flex items-center gap-1 border-b px-3 py-2">
        <IconButton label="Split at playhead" shortcut="S" onClick={splitAtPlayhead}>
          <Scissors className="size-4" />
        </IconButton>
        <IconButton label="Duplicate clip" shortcut="mod+D" onClick={() => duplicateClip(clip.id)}>
          <Copy className="size-4" />
        </IconButton>
        <IconButton label="Delete clip" shortcut="delete" onClick={() => deleteClip(clip.id)}>
          <Trash2 className="size-4" />
        </IconButton>
        <span className="ml-auto text-xs text-muted-foreground">
          Length <span className="font-mono text-ink tabular-nums" data-clip-length>{formatTime(lengthMs, true)}</span>
        </span>
      </div>

      <Section id="clip-transform" title="Transform">
        <Segmented
          label="Fit"
          value={frame.fit}
          options={[
            { value: "fill", label: "Fill" },
            { value: "fit", label: "Fit" },
          ]}
          onChange={(fit) => update({ frame: { fit } })}
        />
        <SliderRow label="Scale" value={Math.round(frame.scale * 100)} min={20} max={400} format={pct} onChange={(v) => update({ frame: { scale: v / 100 } })} />
        <SliderRow label="Position X" value={Math.round(frame.x * 100)} min={-100} max={100} format={signed} onChange={(v) => update({ frame: { x: v / 100 } })} />
        <SliderRow label="Position Y" value={Math.round(frame.y * 100)} min={-100} max={100} format={signed} onChange={(v) => update({ frame: { y: v / 100 } })} />
        <Row label="Rotate">
          <Segmented
            label="Rotate"
            className="w-[180px]"
            value={frame.rotate}
            options={([0, 90, 180, 270] as const).map((r) => ({ value: r, label: `${r}°` }))}
            onChange={(rotate) => update({ frame: { rotate } })}
          />
        </Row>
        <Row label="Flip">
          <div className="flex gap-1">
            <IconButton label="Flip horizontal" pressed={frame.flipH} onClick={() => update({ frame: { flipH: !frame.flipH } })} className="border">
              <FlipHorizontal2 className="size-4" />
            </IconButton>
            <IconButton label="Flip vertical" pressed={frame.flipV} onClick={() => update({ frame: { flipV: !frame.flipV } })} className="border">
              <FlipVertical2 className="size-4" />
            </IconButton>
          </div>
        </Row>
        <ResetLink onClick={() => update({ frame: { fit: "fill", scale: 1, x: 0, y: 0, rotate: 0, flipH: false, flipV: false } })} />
      </Section>

      <Section id="clip-speed" title="Speed" aside={<span className="font-mono text-xs text-muted-foreground">{clip.speed}×</span>}>
        <Segmented
          label="Speed"
          value={SPEEDS.includes(clip.speed) ? clip.speed : null}
          options={SPEEDS.map((s) => ({ value: s, label: `${s}×` }))}
          onChange={(speed) => update({ speed })}
        />
        <SliderRow
          label="Custom"
          value={clip.speed}
          min={0.25}
          max={4}
          step={0.05}
          format={(v) => `${v.toFixed(2)}×`}
          onChange={(speed) => update({ speed: Math.round(speed * 100) / 100 })}
        />
      </Section>

      <Section id="clip-audio" title="Volume">
        <div className="flex items-end gap-2">
          <div className="flex-1">
            <SliderRow
              label="Volume"
              value={clip.muted ? 0 : Math.round(clip.volume * 100)}
              min={0}
              max={200}
              format={pct}
              onChange={(v) => update({ volume: v / 100, muted: false })}
            />
          </div>
          <IconButton label={clip.muted ? "Unmute" : "Mute"} pressed={clip.muted} onClick={() => update({ muted: !clip.muted })} className="border">
            {clip.muted ? <VolumeX className="size-4" /> : <Volume2 className="size-4" />}
          </IconButton>
        </div>
      </Section>

      <Section id="clip-color" title="Color">
        <div className="grid grid-cols-4 gap-1">
          {COLOR_PRESETS.map((p) => (
            <button
              key={p.value}
              onClick={() => update({ color: { preset: p.value } })}
              aria-pressed={color.preset === p.value}
              className={cn(
                "h-7 rounded-[8px] text-xs transition-colors",
                color.preset === p.value ? "bg-ink text-white" : "bg-surface text-ink-2 hover:text-ink",
              )}
            >
              {p.label}
            </button>
          ))}
        </div>
        {(["brightness", "contrast", "saturation", "temperature"] as const).map((k) => (
          <SliderRow
            key={k}
            label={k[0].toUpperCase() + k.slice(1)}
            value={Math.round(color[k] * 100)}
            min={-100}
            max={100}
            format={signed}
            onChange={(v) => update({ color: { [k]: v / 100 } })}
          />
        ))}
        <ResetLink onClick={() => update({ color: { preset: "none", brightness: 0, contrast: 0, saturation: 0, temperature: 0 } })} />
      </Section>
    </>
  );
}

function ResetLink({ onClick }: { onClick: () => void }) {
  return (
    <button onClick={onClick} className="text-xs text-muted-foreground underline-offset-2 hover:text-ink hover:underline">
      Reset
    </button>
  );
}

/* ---------- Text ---------- */

const ANIMATIONS: { value: AnimationType; label: string }[] = [
  { value: "none", label: "None" },
  { value: "fade", label: "Fade" },
  { value: "pop", label: "Pop" },
  { value: "slide-up", label: "Slide up" },
  { value: "slide-down", label: "Slide down" },
  { value: "slide-left", label: "Slide left" },
  { value: "slide-right", label: "Slide right" },
  { value: "typewriter", label: "Typewriter" },
  { value: "bounce", label: "Bounce" },
];

const CASES: { value: TextStyle["case"]; label: string; title: string }[] = [
  { value: "none", label: "Aa", title: "As typed" },
  { value: "upper", label: "AA", title: "Uppercase" },
  { value: "lower", label: "aa", title: "Lowercase" },
  { value: "title", label: "Ab", title: "Title case" },
];

const WEIGHTS = [
  { value: 400, label: "Regular" },
  { value: 600, label: "Semi" },
  { value: 700, label: "Bold" },
  { value: 900, label: "Black" },
];

type ItemPatch = Extract<EditCommand, { type: "updateItem" }>["patch"];

/** A preset as a style patch: every field set, effects the preset lacks turned off. */
function presetPatch(presetId: string, size: number): ItemPatch {
  const s = presetTextStyle(presetById(presetId), size);
  return {
    presetId,
    style: { ...s, gradient: s.gradient ?? null, stroke: s.stroke ?? null, shadow: s.shadow ?? null, background: s.background ?? null },
  };
}

function TextInspector({ text }: { text: TextItem }) {
  const update = (patch: ItemPatch) => dispatch({ type: "updateItem", itemId: text.id, patch });
  const duration = useTimeline({ original: false }).durationMs;
  const { style, transform, animation } = text;

  return (
    <>
      <div className="flex items-center gap-1 border-b px-3 py-2">
        <IconButton label="Duplicate text" onClick={() => duplicateText(text.id)}>
          <Copy className="size-4" />
        </IconButton>
        <IconButton label="Delete text" shortcut="delete" onClick={deleteSelection}>
          <Trash2 className="size-4" />
        </IconButton>
      </div>
      <Section id="text-content" title="Content">
        <textarea
          value={text.text}
          onChange={(e) => update({ text: e.target.value })}
          onKeyDown={(e) => e.stopPropagation()}
          rows={2}
          aria-label="Text content"
          className="w-full resize-none rounded-[10px] border px-2.5 py-2 text-[13px] outline-none focus:border-ink"
        />
        <Segmented label="Letter case" value={style.case} options={CASES} onChange={(c) => update({ style: { case: c } })} />
      </Section>
      <Section id="text-style" title="Style">
        <div className="grid grid-cols-3 gap-1.5">
          {CAPTION_PRESETS.map((p) => (
            <button
              key={p.id}
              onClick={() => update(presetPatch(p.id, style.size))}
              aria-pressed={text.presetId === p.id}
              title={p.name}
              className={cn(
                "grid h-10 place-items-center rounded-[8px] bg-[#2a2a2e] text-[12px] ring-2 ring-offset-1 transition",
                text.presetId === p.id ? "ring-ink" : "ring-transparent hover:ring-line",
              )}
            >
              <span style={captionTextStyle(p, false)}>Aa</span>
            </button>
          ))}
        </div>
        <SelectRow
          label="Font"
          value={style.fontFamily}
          options={FONT_FAMILIES.some((f) => f.value === style.fontFamily) ? FONT_FAMILIES : [{ label: "Preset font", value: style.fontFamily }, ...FONT_FAMILIES]}
          onChange={(fontFamily) => update({ style: { fontFamily } })}
        />
        <div className="flex items-center gap-1">
          <Segmented
            label="Font weight"
            className="flex-1"
            value={style.fontWeight}
            options={WEIGHTS}
            onChange={(fontWeight) => update({ style: { fontWeight } })}
          />
          <IconButton label="Italic" pressed={style.italic} onClick={() => update({ style: { italic: !style.italic } })} className="border">
            <Italic className="size-4" />
          </IconButton>
        </div>
        <SliderRow label="Size" value={style.size} min={16} max={240} onChange={(size) => update({ style: { size } })} />
        <Segmented
          label="Alignment"
          value={style.align}
          options={[
            { value: "left", label: <AlignLeft className="size-4" />, title: "Align left" },
            { value: "center", label: <AlignCenter className="size-4" />, title: "Align center" },
            { value: "right", label: <AlignRight className="size-4" />, title: "Align right" },
          ]}
          onChange={(align) => update({ style: { align } })}
        />
        <ColorField value={style.color} onChange={(color) => update({ style: { color, gradient: null } })} label="Text color" />
      </Section>
      <Section id="text-effects" title="Effects" defaultOpen={false}>
        <ToggleRow label="Outline" checked={!!style.stroke} onChange={(on) => update({ style: { stroke: on ? {} : null } })} />
        {style.stroke && (
          <>
            <ColorField value={style.stroke.color} onChange={(color) => update({ style: { stroke: { color } } })} label="Outline color" />
            <SliderRow label="Thickness" value={style.stroke.width} min={0} max={30} onChange={(width) => update({ style: { stroke: { width } } })} />
          </>
        )}
        <ToggleRow label="Shadow" checked={!!style.shadow} onChange={(on) => update({ style: { shadow: on ? {} : null } })} />
        {style.shadow && (
          <>
            <ColorField value={style.shadow.color} onChange={(color) => update({ style: { shadow: { color } } })} label="Shadow color" />
            <SliderRow label="Blur" value={style.shadow.blur} min={0} max={60} onChange={(blur) => update({ style: { shadow: { blur } } })} />
          </>
        )}
        <ToggleRow label="Background box" checked={!!style.background} onChange={(on) => update({ style: { background: on ? {} : null } })} />
        {style.background && (
          <>
            <ColorField value={style.background.color} onChange={(color) => update({ style: { background: { color } } })} label="Box color" />
            <SliderRow
              label="Box opacity"
              value={Math.round(style.background.opacity * 100)}
              min={0}
              max={100}
              format={pct}
              onChange={(v) => update({ style: { background: { opacity: v / 100 } } })}
            />
          </>
        )}
      </Section>
      <Section id="text-transform" title="Position">
        <SliderRow label="Position X" value={Math.round(transform.x * 100)} min={0} max={100} format={pct} onChange={(v) => update({ transform: { x: v / 100 } })} />
        <SliderRow label="Position Y" value={Math.round(transform.y * 100)} min={0} max={100} format={pct} onChange={(v) => update({ transform: { y: v / 100 } })} />
        <SliderRow label="Rotation" value={Math.round(transform.rotation)} min={-180} max={180} format={(v) => `${v}°`} onChange={(rotation) => update({ transform: { rotation } })} />
        <SliderRow label="Opacity" value={Math.round(transform.opacity * 100)} min={0} max={100} format={pct} onChange={(v) => update({ transform: { opacity: v / 100 } })} />
      </Section>
      <Section id="text-animation" title="Animation">
        <SelectRow
          label="In"
          value={animation.in.type}
          options={ANIMATIONS}
          onChange={(type) => update({ animation: { in: { type, durationMs: animation.in.durationMs || 250 } } })}
        />
        <SelectRow
          label="Out"
          value={animation.out.type}
          options={ANIMATIONS}
          onChange={(type) => update({ animation: { out: { type, durationMs: animation.out.durationMs || 200 } } })}
        />
        <Segmented
          label="Loop"
          value={animation.loop}
          options={[
            { value: "none", label: "No loop" },
            { value: "pulse", label: "Pulse" },
            { value: "wiggle", label: "Wiggle" },
          ]}
          onChange={(loop) => update({ animation: { loop } })}
        />
      </Section>
      <Section id="text-timing" title="Timing">
        <div className="grid grid-cols-2 gap-2">
          <NumberField
            label="Start"
            suffix="s"
            value={+(text.startMs / 1000).toFixed(2)}
            min={0}
            max={+(text.endMs / 1000 - 0.1).toFixed(2)}
            onCommit={(v) => update({ startMs: Math.round(v * 1000) })}
          />
          <NumberField
            label="End"
            suffix="s"
            value={+(text.endMs / 1000).toFixed(2)}
            min={+(text.startMs / 1000 + 0.1).toFixed(2)}
            max={+(duration / 1000).toFixed(2)}
            onCommit={(v) => update({ endMs: Math.round(v * 1000) })}
          />
        </div>
        <button
          onClick={() => playerControls.seekOutputMs(text.startMs)}
          className="text-xs text-muted-foreground underline-offset-2 hover:text-ink hover:underline"
        >
          Go to start
        </button>
      </Section>
    </>
  );
}

function SelectRow<T extends string>({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: T;
  options: { value: T; label: string }[];
  onChange: (v: T) => void;
}) {
  return (
    <Row label={label}>
      <select
        value={value}
        aria-label={label}
        onChange={(e) => onChange(e.target.value as T)}
        onKeyDown={(e) => e.stopPropagation()}
        className="h-8 w-[160px] min-w-0 rounded-[10px] border bg-white px-2 text-[13px] outline-none focus:border-ink"
      >
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </Row>
  );
}

/* ---------- Zoom ---------- */

function ZoomInspector({ zoomId }: { zoomId: string }) {
  const z = usePlan().zooms.items.find((x) => x.id === zoomId)!;
  const update = (patch: Extract<EditCommand, { type: "updateZoom" }>["patch"]) => dispatch({ type: "updateZoom", zoomId, patch });
  return (
    <>
      <div className="flex items-center gap-1 border-b px-3 py-2">
        <IconButton label="Delete zoom" shortcut="delete" onClick={deleteSelection}>
          <Trash2 className="size-4" />
        </IconButton>
      </div>
      <Section id="zoom-style" title="Style">
        <Segmented label="Zoom style" value={z.style} options={ZOOM_STYLES} onChange={(style) => update({ style })} />
        <SliderRow label="Strength" value={Math.round(z.scale * 100)} min={105} max={160} format={(v) => `${v}%`} onChange={(v) => update({ scale: v / 100 })} />
        <SliderRow
          label="Length"
          value={Math.round((z.endMs - z.startMs) / 100) / 10}
          min={0.5}
          max={5}
          step={0.1}
          format={(v) => `${v.toFixed(1)}s`}
          onChange={(v) => update({ endMs: z.startMs + v * 1000 })}
        />
      </Section>
      <Section id="zoom-focus" title="Focus point">
        <SliderRow label="Horizontal" value={Math.round(z.focusX * 100)} min={0} max={100} format={pct} onChange={(v) => update({ focusX: v / 100 })} />
        <SliderRow label="Vertical" value={Math.round(z.focusY * 100)} min={10} max={90} format={pct} onChange={(v) => update({ focusY: v / 100 })} />
      </Section>
    </>
  );
}

/* ---------- Word ---------- */

function WordInspector({ wordId }: { wordId: string }) {
  const plan = usePlan();
  const source = plan.sources[0];
  const w = source.words.find((x) => x.id === wordId)!;
  return (
    <WordActions
      key={w.id}
      text={plan.captions.edits[w.id] ?? w.text}
      cut={isWordCut(plan, source.id, w)}
      highlighted={plan.captions.highlights.includes(w.id)}
      emoji={plan.captions.emojis[w.id]}
      onCut={() => dispatch({ type: "toggleWordCut", sourceId: source.id, wordId: w.id })}
      onHighlight={() => dispatch({ type: "toggleHighlight", wordId: w.id })}
      onEmoji={(emoji) => dispatch({ type: "setEmoji", wordId: w.id, emoji })}
      onText={(text) => dispatch({ type: "setWordText", wordId: w.id, text })}
    />
  );
}

/* ---------- Project ---------- */

const ASPECTS: { value: Aspect; label: string; w: number; h: number }[] = [
  { value: "9:16", label: "9:16", w: 9, h: 16 },
  { value: "1:1", label: "1:1", w: 1, h: 1 },
  { value: "4:5", label: "4:5", w: 4, h: 5 },
  { value: "16:9", label: "16:9", w: 16, h: 9 },
  { value: "custom", label: "Custom", w: 0, h: 0 },
];

const SWATCHES = ["#000000", "#ffffff", "#1d1d1f", "#f5f5f7", "#ff5b1f", "#ffd60a"];

function ProjectInspector() {
  const { canvas, progressBar: bar } = usePlan();
  const setCanvas = (c: Extract<EditCommand, { type: "setCanvas" }>["canvas"]) => dispatch({ type: "setCanvas", canvas: c });

  return (
    <>
      <Section id="project-canvas" title="Canvas">
        <div className="grid grid-cols-5 gap-1" role="group" aria-label="Aspect ratio">
          {ASPECTS.map((a) => {
            const active = canvas.aspect === a.value;
            const scale = a.w ? 18 / Math.max(a.w, a.h) : 0;
            return (
              <button
                key={a.value}
                onClick={() => setCanvas({ aspect: a.value })}
                aria-pressed={active}
                aria-label={a.value === "custom" ? "Custom size" : `Aspect ${a.label}`}
                className={cn(
                  "flex h-14 flex-col items-center justify-center gap-1.5 rounded-[10px] border text-[11px] transition-colors",
                  active ? "border-ink text-ink" : "text-ink-2 hover:bg-surface",
                )}
              >
                {a.w ? (
                  <span className="rounded-[2px] border-[1.5px] border-current" style={{ width: a.w * scale, height: a.h * scale }} />
                ) : (
                  <SlidersHorizontal className="size-[18px]" strokeWidth={1.5} />
                )}
                {a.label}
              </button>
            );
          })}
        </div>
        <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-1.5">
          <NumberField
            label="W"
            value={canvas.width}
            min={240}
            max={4096}
            onCommit={(width) => setCanvas({ width, aspect: "custom" })}
          />
          <span className="text-xs text-muted-foreground">×</span>
          <NumberField
            label="H"
            value={canvas.height}
            min={240}
            max={4096}
            onCommit={(height) => setCanvas({ height, aspect: "custom" })}
          />
        </div>
        {canvas.aspect !== "custom" && (
          <p className="text-xs text-muted-foreground">
            {ASPECT_SIZES[canvas.aspect].width}×{ASPECT_SIZES[canvas.aspect].height} is the standard size for {canvas.aspect}.
          </p>
        )}
        <Row label="Frame rate">
          <Segmented
            label="Frame rate"
            className="w-[176px]"
            value={canvas.fps}
            options={[24, 25, 30, 60].map((f) => ({ value: f, label: String(f) }))}
            onChange={(fps) => setCanvas({ fps })}
          />
        </Row>
      </Section>

      <Section id="project-background" title="Background">
        <p className="-mt-1 text-xs text-muted-foreground">Shows where the video doesn&apos;t fill the canvas.</p>
        <Segmented
          label="Background"
          value={canvas.background.type}
          options={[
            { value: "blur", label: "Blurred video" },
            { value: "color", label: "Color" },
          ]}
          onChange={(type) => setCanvas({ background: { ...canvas.background, type } })}
        />
        {canvas.background.type === "color" && (
          <ColorField value={canvas.background.color} onChange={(color) => setCanvas({ background: { type: "color", color } })} label="Background color" />
        )}
      </Section>

      <Section id="project-progress" title="Progress bar">
        <ToggleRow label="Show progress bar" checked={bar.enabled} onChange={(enabled) => dispatch({ type: "setProgressBar", bar: { enabled } })} />
        {bar.enabled && (
          <>
            <Row label="Position">
              <Segmented
                label="Progress bar position"
                className="w-[140px]"
                value={bar.position}
                options={[
                  { value: "top", label: "Top" },
                  { value: "bottom", label: "Bottom" },
                ]}
                onChange={(position) => dispatch({ type: "setProgressBar", bar: { position } })}
              />
            </Row>
            <ColorField value={bar.color} onChange={(color) => dispatch({ type: "setProgressBar", bar: { color } })} label="Bar color" />
          </>
        )}
      </Section>
    </>
  );
}

function ColorField({ value, onChange, label }: { value: string; onChange: (c: string) => void; label: string }) {
  const [draft, setDraft] = useState(value);
  const [shown, setShown] = useState(value);
  if (shown !== value) {
    setShown(value);
    setDraft(value);
  }
  const commit = () => (/^#[0-9a-f]{6}([0-9a-f]{2})?$/i.test(draft) ? onChange(draft.toLowerCase()) : setDraft(value));
  return (
    <div className="flex items-center gap-2">
      <Popover>
        <PopoverTrigger asChild>
          <button aria-label={`${label}: pick`} className="size-8 shrink-0 rounded-[10px] border" style={{ background: value }} />
        </PopoverTrigger>
        <PopoverContent align="start" className="w-[232px] space-y-3 p-3">
          <HexColorPicker color={value} onChange={onChange} style={{ width: "100%", height: 160 }} />
          <div className="flex gap-1.5">
            {SWATCHES.map((c) => (
              <button
                key={c}
                onClick={() => onChange(c)}
                aria-label={c}
                className={cn("size-6 rounded-full border", value === c && "ring-2 ring-ink ring-offset-1")}
                style={{ background: c }}
              />
            ))}
          </div>
        </PopoverContent>
      </Popover>
      <input
        value={draft}
        aria-label={label}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          e.stopPropagation();
          if (e.key === "Enter") (e.target as HTMLInputElement).blur();
        }}
        className="h-8 w-full min-w-0 rounded-[10px] border px-2.5 font-mono text-xs uppercase outline-none focus:border-ink"
      />
    </div>
  );
}
