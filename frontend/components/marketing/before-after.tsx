"use client";

import { useCallback, useRef, useState } from "react";
import { AnimatedCaption } from "@/components/captions/animated-caption";
import { CAPTION_PRESETS } from "@/lib/caption-presets";
import type { DemoClip } from "@/lib/demo-clips";
import { cn } from "@/lib/utils";

// One real clip, split by a draggable line: raw on the left, Shortcraft on the right.
// A single <video> keeps both sides in perfect sync; the raw side is a backdrop filter.
export function BeforeAfter({ clip, className }: { clip: DemoClip; className?: string }) {
  const [pos, setPos] = useState(50);
  const ref = useRef<HTMLDivElement>(null);
  const preset = CAPTION_PRESETS.find((p) => p.id === clip.presetId) ?? CAPTION_PRESETS[0];

  const moveTo = useCallback((clientX: number) => {
    const box = ref.current?.getBoundingClientRect();
    if (!box) return;
    setPos(Math.min(100, Math.max(0, ((clientX - box.left) / box.width) * 100)));
  }, []);

  return (
    <div
      ref={ref}
      className={cn("relative aspect-[9/16] touch-none overflow-hidden rounded-[20px] bg-ink select-none", className)}
      onPointerDown={(e) => {
        e.currentTarget.setPointerCapture(e.pointerId);
        moveTo(e.clientX);
      }}
      onPointerMove={(e) => e.buttons === 1 && moveTo(e.clientX)}
    >
      <video
        src={clip.src}
        poster={clip.poster}
        autoPlay
        muted
        loop
        playsInline
        className="absolute inset-0 size-full object-cover"
      />

      {/* Edited layer, clipped to the right of the handle */}
      <div className="absolute inset-0" style={{ clipPath: `inset(0 0 0 ${pos}%)` }}>
        <div className="absolute inset-x-3 top-[8%] flex justify-center">
          <span className="rounded-lg bg-white px-2.5 py-1.5 text-center text-[13px] leading-tight font-bold text-black">
            {clip.hook}
          </span>
        </div>
        <div className="absolute inset-x-2 bottom-[17%] text-[22px]">
          <AnimatedCaption preset={preset} />
        </div>
      </div>

      {/* Raw layer: flat, washed-out look */}
      <div
        className="absolute inset-y-0 left-0 backdrop-brightness-90 backdrop-contrast-[.85] backdrop-saturate-50"
        style={{ width: `${pos}%` }}
      />

      <span className="pointer-events-none absolute top-3 left-3 rounded-full bg-black/55 px-2.5 py-1 text-[11px] font-medium text-white backdrop-blur">
        Before
      </span>
      <span className="pointer-events-none absolute top-3 right-3 rounded-full bg-white/90 px-2.5 py-1 text-[11px] font-medium text-ink backdrop-blur">
        After
      </span>

      {/* Handle */}
      <div className="pointer-events-none absolute inset-y-0 w-0.5 -translate-x-1/2 bg-white" style={{ left: `${pos}%` }}>
        <span className="absolute top-1/2 left-1/2 grid size-9 -translate-x-1/2 -translate-y-1/2 place-items-center rounded-full bg-white shadow-lg">
          <svg viewBox="0 0 16 16" className="size-4 text-ink" fill="none" stroke="currentColor" strokeWidth="1.75">
            <path d="M6 4 2 8l4 4M10 4l4 4-4 4" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </span>
      </div>

      <input
        type="range"
        min={0}
        max={100}
        value={pos}
        onChange={(e) => setPos(Number(e.target.value))}
        aria-label="Compare before and after"
        className="sr-only"
      />
    </div>
  );
}
