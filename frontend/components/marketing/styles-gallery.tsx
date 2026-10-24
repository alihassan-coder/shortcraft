"use client";

import { useState } from "react";
import { AnimatedCaption } from "@/components/captions/animated-caption";
import { Switch } from "@/components/ui/switch";
import { CAPTION_PRESETS, type CaptionPreset } from "@/lib/caption-presets";
import { clipById } from "@/lib/demo-clips";
import { cn } from "@/lib/utils";
import { PhoneVideo } from "./phone-video";

const GROUPS: { label: string; ids: string[] }[] = [
  { label: "All", ids: CAPTION_PRESETS.map((p) => p.id) },
  { label: "Bold", ids: ["bold-pop", "beast", "neon", "gradient", "boxed"] },
  { label: "Clean", ids: ["clean", "minimal", "pro-subtle", "story"] },
  { label: "Playful", ids: ["karaoke", "comic", "typewriter", "neon"] },
];

function StyleTile({ preset, active, onSelect }: { preset: CaptionPreset; active: boolean; onSelect: () => void }) {
  return (
    <button onClick={onSelect} aria-pressed={active} className="group text-left">
      <div
        className={cn(
          "relative grid aspect-[4/5] place-items-center overflow-hidden rounded-[20px] bg-ink bg-cover bg-center px-3 text-[20px] ring-2 ring-offset-4 transition",
          active ? "ring-ink" : "ring-transparent group-hover:ring-line",
        )}
        style={{
          backgroundImage: `linear-gradient(rgba(0,0,0,.25),rgba(0,0,0,.45)), url(${clipById("39813").poster})`,
        }}
      >
        <AnimatedCaption preset={preset} showEmoji={false} wordMs={460} />
      </div>
      <p className="mt-3 font-medium">{preset.name}</p>
      <p className="text-sm text-muted-foreground">{preset.description}</p>
    </button>
  );
}

export function StylesGallery() {
  const [group, setGroup] = useState("All");
  const [selectedId, setSelectedId] = useState("bold-pop");
  const [emoji, setEmoji] = useState(true);
  const ids = GROUPS.find((g) => g.label === group)!.ids;
  const presets = CAPTION_PRESETS.filter((p) => ids.includes(p.id));
  const selected = CAPTION_PRESETS.find((p) => p.id === selectedId)!;

  return (
    <div className="grid items-start gap-12 lg:grid-cols-[1fr_300px]">
      <div>
        <div className="flex flex-wrap gap-2" role="group" aria-label="Filter styles">
          {GROUPS.map((g) => (
            <button
              key={g.label}
              onClick={() => setGroup(g.label)}
              aria-pressed={g.label === group}
              className={cn(
                "rounded-full px-4 py-2 text-sm transition-colors",
                g.label === group ? "bg-ink text-white" : "bg-surface text-ink-2 hover:text-ink",
              )}
            >
              {g.label}
            </button>
          ))}
        </div>
        <div className="mt-8 grid grid-cols-2 gap-x-5 gap-y-9 sm:grid-cols-3">
          {presets.map((p) => (
            <StyleTile key={p.id} preset={p} active={p.id === selectedId} onSelect={() => setSelectedId(p.id)} />
          ))}
        </div>
      </div>

      <aside className="lg:sticky lg:top-24">
        <div className="rounded-[28px] bg-surface p-6">
          <PhoneVideo clip={clipById("42323")} presetId={selected.id} showEmoji={emoji} hook={false} zoom={false} captionSize={22} />
          <div className="mt-5 flex items-center justify-between">
            <div>
              <p className="font-medium">{selected.name}</p>
              <p className="text-sm text-muted-foreground">Live preview</p>
            </div>
            <label className="flex items-center gap-2 text-sm">
              Emojis <Switch checked={emoji} onCheckedChange={setEmoji} />
            </label>
          </div>
        </div>
      </aside>
    </div>
  );
}
