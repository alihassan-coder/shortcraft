"use client";

import { motion } from "motion/react";
import { AnimatedCaption, type DemoWord } from "@/components/captions/animated-caption";
import { CAPTION_PRESETS } from "@/lib/caption-presets";
import type { DemoClip } from "@/lib/demo-clips";
import { cn } from "@/lib/utils";

// A 9:16 frame with a real looping clip and the Shortcraft edit layered on top.
// `edited={false}` shows the raw look: flat color, no captions, no zoom.
export function PhoneVideo({
  clip,
  edited = true,
  captions = true,
  hook = true,
  zoom = true,
  words,
  showEmoji = true,
  presetId,
  captionSize = 22,
  className,
}: {
  clip: DemoClip;
  edited?: boolean;
  captions?: boolean;
  hook?: boolean;
  zoom?: boolean;
  words?: DemoWord[];
  showEmoji?: boolean;
  presetId?: string;
  captionSize?: number;
  className?: string;
}) {
  const preset = CAPTION_PRESETS.find((p) => p.id === (presetId ?? clip.presetId)) ?? CAPTION_PRESETS[0];

  return (
    <div className={cn("relative aspect-[9/16] overflow-hidden rounded-[20px] bg-ink", className)}>
      <motion.video
        src={clip.src}
        poster={clip.poster}
        autoPlay
        muted
        loop
        playsInline
        preload="metadata"
        className="absolute inset-0 size-full object-cover"
        style={{ filter: edited ? "saturate(1.1) contrast(1.05)" : "saturate(0.6) contrast(0.88) brightness(0.9)" }}
        animate={edited && zoom ? { scale: [1, 1, 1.22, 1.22, 1] } : { scale: 1 }}
        transition={
          edited && zoom
            ? { duration: 8, repeat: Infinity, times: [0, 0.3, 0.33, 0.62, 0.66], ease: "easeOut" }
            : { duration: 0.3 }
        }
      />

      {edited && hook && (
        <div className="absolute inset-x-3 top-[8%] flex justify-center">
          <span className="rounded-lg bg-white px-2.5 py-1.5 text-center text-[13px] font-extrabold leading-tight text-black">
            {clip.hook}
          </span>
        </div>
      )}

      {edited && captions && (
        <div className="absolute inset-x-2 bottom-[18%]" style={{ fontSize: captionSize }}>
          <AnimatedCaption preset={preset} words={words} showEmoji={showEmoji} />
        </div>
      )}
    </div>
  );
}
