"use client";

import { CAPTION_PRESETS, captionTextStyle } from "@/lib/caption-presets";
import type { Vibe } from "@/lib/upload/project-index";
import { cn } from "@/lib/utils";

type VibeOption = {
  id: Vibe;
  name: string;
  blurb: string;
  presetId: string;
  sample: { text: string; highlight?: boolean }[];
  fallback: string;
};

// Mirrors the backend's basic plan: preset, zoom and music per vibe (docs/BACKEND.md §4).
export const VIBES: VibeOption[] = [
  {
    id: "energetic",
    name: "Energetic",
    blurb: "Bold captions, punchy zooms, upbeat music.",
    presetId: "bold-pop",
    sample: [{ text: "This" }, { text: "changed" }, { text: "everything", highlight: true }],
    fallback: "/media/clip-42323.jpg",
  },
  {
    id: "clean",
    name: "Clean",
    blurb: "Calm captions, gentle zooms, light music.",
    presetId: "clean",
    sample: [{ text: "Here’s" }, { text: "what" }, { text: "I" }, { text: "learned" }],
    fallback: "/media/clip-41290.jpg",
  },
  {
    id: "story",
    name: "Story",
    blurb: "Soft serif captions, slow zooms, warm music.",
    presetId: "story",
    sample: [{ text: "It" }, { text: "started" }, { text: "with" }, { text: "one", highlight: true }, { text: "idea" }],
    fallback: "/media/clip-39813.jpg",
  },
];

export function VibePicker({ value, onChange, poster }: { value: Vibe; onChange: (v: Vibe) => void; poster?: string | null }) {
  return (
    <div role="radiogroup" aria-label="Vibe" className="grid gap-3 sm:grid-cols-3 sm:gap-4">
      {VIBES.map((vibe) => {
        const preset = CAPTION_PRESETS.find((p) => p.id === vibe.presetId) ?? CAPTION_PRESETS[0];
        const selected = value === vibe.id;
        return (
          <button
            key={vibe.id}
            type="button"
            role="radio"
            aria-checked={selected}
            onClick={() => onChange(vibe.id)}
            onKeyDown={(e) => {
              const i = VIBES.findIndex((v) => v.id === vibe.id);
              const step = e.key === "ArrowRight" || e.key === "ArrowDown" ? 1 : e.key === "ArrowLeft" || e.key === "ArrowUp" ? -1 : 0;
              if (!step) return;
              e.preventDefault();
              const next = VIBES[(i + step + VIBES.length) % VIBES.length];
              onChange(next.id);
              (e.currentTarget.parentElement?.querySelector(`[data-vibe="${next.id}"]`) as HTMLElement | null)?.focus();
            }}
            tabIndex={selected ? 0 : -1}
            data-vibe={vibe.id}
            className={cn(
              "group flex gap-4 rounded-[20px] p-2 text-left ring-1 transition-[box-shadow,background-color] focus-visible:ring-3 focus-visible:ring-rec/40 focus-visible:outline-none sm:flex-col sm:gap-0",
              selected ? "bg-white ring-2 ring-ink" : "bg-white ring-line hover:ring-[#c9c9d0]",
            )}
          >
            <div className="relative aspect-[9/14] w-[84px] shrink-0 overflow-hidden rounded-[14px] bg-[#141416] sm:w-full">
              {/* eslint-disable-next-line @next/next/no-img-element -- local poster or static sample */}
              <img src={poster || vibe.fallback} alt="" className="absolute inset-0 size-full object-cover opacity-90" />
              <div className="absolute inset-0 bg-gradient-to-b from-transparent via-transparent to-black/35" />
              <p
                className="absolute inset-x-2 top-[64%] -translate-y-1/2 text-center text-[11px] leading-[1.15] sm:text-[17px]"
                aria-hidden
              >
                {vibe.sample.map((w, i) => (
                  <span key={i} style={captionTextStyle(preset, !!w.highlight)}>
                    {w.text}
                    {i < vibe.sample.length - 1 ? " " : ""}
                  </span>
                ))}
              </p>
            </div>
            <div className="flex min-w-0 flex-1 flex-col justify-center py-1 sm:px-2 sm:pt-3 sm:pb-2">
              <span className="flex items-center gap-2 text-[16px] font-semibold tracking-[-0.01em] text-ink">
                {vibe.name}
                <span
                  aria-hidden
                  className={cn(
                    "ml-auto size-[18px] rounded-full border transition-colors",
                    selected ? "border-[5px] border-ink" : "border-[#c9c9d0]",
                  )}
                />
              </span>
              <span className="mt-1 text-[14px] leading-snug text-muted-foreground">{vibe.blurb}</span>
            </div>
          </button>
        );
      })}
    </div>
  );
}
