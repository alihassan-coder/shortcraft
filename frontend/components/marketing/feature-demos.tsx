"use client";

import { useState } from "react";
import Image from "next/image";
import { Mic, Pause, Play, RotateCcw, ArrowUp } from "lucide-react";
import { Switch } from "@/components/ui/switch";
import { CAPTION_PRESETS, captionTextStyle } from "@/lib/caption-presets";
import { clipById } from "@/lib/demo-clips";
import { cn } from "@/lib/utils";
import { PhoneVideo } from "./phone-video";

export function DemoStage({ children, className }: { children: React.ReactNode; className?: string }) {
  return <div className={cn("rounded-[28px] bg-surface p-4 sm:p-8", className)}>{children}</div>;
}

function Panel({ title, children, className }: { title: string; children: React.ReactNode; className?: string }) {
  return (
    <div className={cn("overflow-hidden rounded-2xl border bg-white", className)}>
      <p className="border-b px-4 py-3 text-xs font-medium text-muted-foreground">{title}</p>
      {children}
    </div>
  );
}

/* ---------- Captions ---------- */

export function CaptionsDemo() {
  const [presetId, setPresetId] = useState("bold-pop");
  const [emoji, setEmoji] = useState(true);

  return (
    <div className="grid items-start gap-4 sm:grid-cols-[1fr_200px]">
      <Panel title="Caption style">
        <div className="grid grid-cols-2 gap-2 p-3">
          {CAPTION_PRESETS.slice(0, 8).map((p) => (
            <button
              key={p.id}
              onClick={() => setPresetId(p.id)}
              aria-pressed={p.id === presetId}
              className={cn(
                "rounded-xl p-1 text-left ring-2 transition",
                p.id === presetId ? "ring-ink" : "ring-transparent hover:ring-line",
              )}
            >
              <span className="grid h-12 place-items-center rounded-lg bg-ink text-[13px]">
                <span className="flex gap-[0.3em]">
                  <span style={captionTextStyle(p, false)}>Watch</span>
                  <span style={captionTextStyle(p, true)}>this</span>
                </span>
              </span>
              <span className="mt-1.5 block px-1 text-xs">{p.name}</span>
            </button>
          ))}
        </div>
        <label className="flex items-center justify-between border-t px-4 py-3 text-sm">
          Emojis
          <Switch checked={emoji} onCheckedChange={setEmoji} />
        </label>
      </Panel>
      <div className="mx-auto w-full max-w-[200px]">
        <PhoneVideo
          clip={clipById("42319")}
          presetId={presetId}
          showEmoji={emoji}
          zoom={false}
          hook={false}
          captionSize={19}
        />
      </div>
    </div>
  );
}

/* ---------- Cuts ---------- */

type Token = { w: string; kind?: "pause" | "filler" | "retake" };
const TRANSCRIPT: Token[] = [
  { w: "So" }, { w: "um", kind: "filler" }, { w: "the" }, { w: "first" }, { w: "thing" },
  { w: "[1.8s]", kind: "pause" }, { w: "the", kind: "retake" }, { w: "first", kind: "retake" },
  { w: "thing", kind: "retake" }, { w: "uh", kind: "filler" }, { w: "you" }, { w: "need" },
  { w: "is" }, { w: "a" }, { w: "hook." }, { w: "[2.4s]", kind: "pause" }, { w: "Like,", kind: "filler" },
  { w: "something" }, { w: "that" }, { w: "makes" }, { w: "people" }, { w: "stop." },
];

export function CutsDemo() {
  const [pauses, setPauses] = useState(true);
  const [fillers, setFillers] = useState(true);
  const [retakes, setRetakes] = useState(true);
  const [restored, setRestored] = useState<number[]>([]);

  const isCut = (t: Token, i: number) =>
    !restored.includes(i) &&
    ((t.kind === "pause" && pauses) || (t.kind === "filler" && fillers) || (t.kind === "retake" && retakes));
  const saved = TRANSCRIPT.reduce((acc, t, i) => acc + (isCut(t, i) ? (t.kind === "pause" ? 2.1 : 0.6) : 0), 0);

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
        {[
          { label: "Long pauses", value: pauses, set: setPauses },
          { label: "Filler words", value: fillers, set: setFillers },
          { label: "Repeated takes", value: retakes, set: setRetakes },
        ].map((o) => (
          <label
            key={o.label}
            className="flex items-center justify-between gap-3 rounded-2xl border bg-white px-4 py-3 text-sm"
          >
            {o.label}
            <Switch checked={o.value} onCheckedChange={o.set} />
          </label>
        ))}
      </div>
      <Panel title="Transcript — click a removed word to restore it">
        <p className="p-5 text-[16px] leading-9">
          {TRANSCRIPT.map((t, i) => (
            <button
              key={i}
              disabled={!t.kind}
              onClick={() => setRestored((r) => (r.includes(i) ? r.filter((x) => x !== i) : [...r, i]))}
              className={cn(
                "mr-1.5 rounded px-0.5 disabled:cursor-text",
                t.kind === "pause" && "font-mono text-xs",
                isCut(t, i) && "bg-cut/10 text-cut line-through decoration-cut/60",
              )}
            >
              {t.w}
            </button>
          ))}
        </p>
        <div className="flex items-center justify-between border-t px-5 py-3 text-sm">
          <span className="font-mono">
            <span className="text-muted-foreground line-through">0:42</span>{" "}
            <span>0:{String(42 - Math.round(saved)).padStart(2, "0")}</span>
          </span>
          {restored.length > 0 && (
            <button
              onClick={() => setRestored([])}
              className="flex items-center gap-1 text-xs text-muted-foreground hover:text-ink"
            >
              <RotateCcw className="size-3" /> Reset
            </button>
          )}
        </div>
      </Panel>
    </div>
  );
}

/* ---------- Zoom ---------- */

const ZOOM_STYLES = ["Smooth", "Punch", "Push", "Linear"];

export function ZoomDemo() {
  const [strength, setStrength] = useState(125);
  const [style, setStyle] = useState("Punch");
  return (
    <div className="grid items-center gap-4 sm:grid-cols-[190px_1fr]">
      <div className="relative mx-auto aspect-[9/16] w-full max-w-[190px] overflow-hidden rounded-[20px] bg-ink">
        <Image
          src={clipById("41290").poster}
          alt="Speaker with a zoom-in applied"
          fill
          sizes="190px"
          className="object-cover transition-transform duration-300"
          style={{ transform: `scale(${strength / 100})` }}
        />
        <span className="absolute top-3 left-3 rounded-full bg-black/55 px-2 py-0.5 font-mono text-[11px] text-white">
          {strength}%
        </span>
      </div>
      <Panel title="Zoom">
        <div className="space-y-6 p-4">
          <div>
            <div className="mb-3 flex justify-between text-sm">
              <span>Strength</span>
              <span className="font-mono text-muted-foreground">{strength}%</span>
            </div>
            <input
              type="range"
              min={105}
              max={150}
              value={strength}
              onChange={(e) => setStrength(Number(e.target.value))}
              className="w-full accent-ink"
              aria-label="Zoom strength"
            />
          </div>
          <div>
            <p className="mb-3 text-sm">Style</p>
            <div className="grid grid-cols-4 gap-1 rounded-xl bg-surface p-1 text-xs">
              {ZOOM_STYLES.map((s) => (
                <button
                  key={s}
                  onClick={() => setStyle(s)}
                  className={cn("rounded-lg py-1.5", s === style ? "bg-white shadow-sm" : "text-muted-foreground")}
                >
                  {s}
                </button>
              ))}
            </div>
          </div>
          <div>
            <p className="mb-3 text-sm">On the timeline</p>
            <div className="relative h-7 rounded-lg bg-surface">
              {[8, 30, 55, 80].map((l) => (
                <span key={l} className="absolute top-1.5 h-4 w-[12%] rounded bg-ink" style={{ left: `${l}%` }} />
              ))}
            </div>
          </div>
        </div>
      </Panel>
    </div>
  );
}

/* ---------- Music ---------- */

const TRACKS = [
  { name: "Morning Run", mood: "Upbeat", length: "2:14" },
  { name: "Soft Focus", mood: "Calm", length: "3:02" },
  { name: "Big Reveal", mood: "Dramatic", length: "1:48" },
  { name: "New Chapter", mood: "Inspiring", length: "2:36" },
];

export function MusicDemo() {
  const [selected, setSelected] = useState(0);
  const [ducking, setDucking] = useState(true);
  return (
    <div className="space-y-4">
      <Panel title="Music library">
        <ul className="divide-y">
          {TRACKS.map((t, i) => (
            <li key={t.name}>
              <button
                onClick={() => setSelected(i)}
                className={cn("flex w-full items-center gap-3 px-4 py-3 text-left text-sm", i === selected && "bg-surface")}
              >
                <span
                  className={cn(
                    "grid size-8 place-items-center rounded-full",
                    i === selected ? "bg-ink text-white" : "border",
                  )}
                >
                  {i === selected ? <Pause className="size-3.5" /> : <Play className="size-3.5" />}
                </span>
                <span className="flex-1 font-medium">{t.name}</span>
                <span className="text-muted-foreground">{t.mood}</span>
                <span className="w-10 text-right font-mono text-xs text-muted-foreground">{t.length}</span>
              </button>
            </li>
          ))}
        </ul>
      </Panel>
      <Panel title="Music volume">
        <div className="p-4">
          <svg viewBox="0 0 300 56" className="h-14 w-full" preserveAspectRatio="none" aria-hidden>
            <rect x="60" y="0" width="150" height="56" rx="6" className="fill-surface" />
            <path
              d={ducking ? "M0 10 L55 10 L68 40 L202 40 L215 10 L300 10" : "M0 10 L300 10"}
              className="fill-none stroke-ink"
              strokeWidth="2"
              vectorEffect="non-scaling-stroke"
            />
          </svg>
          <div className="mt-3 flex flex-wrap items-center justify-between gap-2 text-sm">
            <span className="flex items-center gap-1.5 text-muted-foreground">
              <Mic className="size-3.5" /> Grey area is you talking
            </span>
            <label className="flex items-center gap-2">
              Lower music while I talk
              <Switch checked={ducking} onCheckedChange={setDucking} />
            </label>
          </div>
        </div>
      </Panel>
    </div>
  );
}

/* ---------- Ask for a change ---------- */

const REQUESTS = [
  {
    ask: "Make it more energetic",
    result: ["Shorter pauses", "3 more zoom-ins", "Music: Morning Run", "Captions: Bold Pop"],
  },
  { ask: "Remove the part about pricing", result: ["Cut 0:18 – 0:24", "Captions updated", "New length 0:25"] },
  { ask: "Use calmer captions", result: ["Captions: Clean", "Emojis off"] },
];

export function PromptDemo() {
  const [i, setI] = useState(0);
  const r = REQUESTS[i];
  return (
    <Panel title="Ask for a change">
      <div className="space-y-3 p-4">
        <p className="ml-auto w-fit max-w-[85%] rounded-2xl rounded-br-md bg-ink px-4 py-2.5 text-sm text-white">
          {r.ask}
        </p>
        <div className="w-fit max-w-[90%] rounded-2xl rounded-bl-md bg-surface px-4 py-3 text-sm">
          <p className="font-medium">Done. Here&apos;s what changed:</p>
          <ul className="mt-1.5 space-y-0.5 text-muted-foreground">
            {r.result.map((x) => (
              <li key={x}>{x}</li>
            ))}
          </ul>
          <p className="mt-2 flex items-center gap-1 text-xs text-ink">
            <RotateCcw className="size-3" /> Undo
          </p>
        </div>
      </div>
      <div className="flex flex-wrap gap-2 border-t p-3">
        {REQUESTS.map((q, n) => (
          <button
            key={q.ask}
            onClick={() => setI(n)}
            className={cn(
              "rounded-full border px-3 py-1.5 text-xs transition-colors",
              n === i ? "border-ink bg-ink text-white" : "hover:bg-surface",
            )}
          >
            {q.ask}
          </button>
        ))}
      </div>
      <div className="flex items-center gap-2 border-t py-2.5 pr-2.5 pl-4 text-sm text-muted-foreground">
        <span className="flex-1">Describe a change…</span>
        <span className="grid size-7 place-items-center rounded-full bg-ink text-white">
          <ArrowUp className="size-3.5" />
        </span>
      </div>
    </Panel>
  );
}
