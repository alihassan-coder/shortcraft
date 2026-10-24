"use client";

import { useEffect, useState } from "react";
import { AnimatePresence, motion, type TargetAndTransition } from "motion/react";
import { captionTextStyle, type CaptionPreset } from "@/lib/caption-presets";
import { cn } from "@/lib/utils";

export type DemoWord = { text: string; highlight?: boolean; emoji?: string };

export const DEMO_SCRIPT: DemoWord[] = [
  { text: "This" },
  { text: "one" },
  { text: "trick", highlight: true, emoji: "🔥" },
  { text: "saved" },
  { text: "me" },
  { text: "10", highlight: true },
  { text: "hours", highlight: true, emoji: "⏰" },
  { text: "every" },
  { text: "single" },
  { text: "week", highlight: true },
];

const ENTER: Record<CaptionPreset["animation"], TargetAndTransition> = {
  pop: { scale: [0.6, 1.12, 1], opacity: [0, 1, 1] },
  bounce: { y: [18, -6, 0], opacity: [0, 1, 1] },
  fade: { opacity: [0, 1] },
  slide: { x: [-14, 0], opacity: [0, 1] },
  karaoke: { opacity: 1 },
  typewriter: { opacity: 1 },
};

function chunk(words: DemoWord[], size: number) {
  const lines: DemoWord[][] = [];
  for (let i = 0; i < words.length; i += size) lines.push(words.slice(i, i + size));
  return lines;
}

// Loops a short script word by word in the given preset. Fake timing for the
// landing page; the editor will drive this from real word timestamps.
export function AnimatedCaption({
  preset,
  words = DEMO_SCRIPT,
  showEmoji = true,
  wordMs = 380,
  className,
}: {
  preset: CaptionPreset;
  words?: DemoWord[];
  showEmoji?: boolean;
  wordMs?: number;
  className?: string;
}) {
  const [index, setIndex] = useState(0);

  useEffect(() => {
    const id = setInterval(() => setIndex((i) => (i + 1) % (words.length + 2)), wordMs);
    return () => clearInterval(id);
  }, [words.length, wordMs]);

  const lines = chunk(words, preset.wordsPerLine);
  const active = Math.min(index, words.length - 1);
  const lineIndex = Math.floor(active / preset.wordsPerLine);
  const line = lines[lineIndex] ?? [];
  const lineStart = lineIndex * preset.wordsPerLine;
  const emoji = showEmoji ? line.find((w, i) => w.emoji && lineStart + i <= active)?.emoji : undefined;

  return (
    <div className={cn("flex flex-col items-center gap-1 text-center", className)}>
      <AnimatePresence mode="wait">
        {emoji && (
          <motion.span
            key={`${lineIndex}-${emoji}`}
            initial={{ scale: 0, rotate: -20 }}
            animate={{ scale: 1, rotate: 0 }}
            exit={{ scale: 0 }}
            className="text-[1.6em] leading-none"
          >
            {emoji}
          </motion.span>
        )}
      </AnimatePresence>
      <div className="flex flex-wrap justify-center gap-x-[0.3em] gap-y-1 leading-tight">
        {line.map((word, i) => {
          const wordIndex = lineStart + i;
          const spoken = wordIndex <= active;
          const current = wordIndex === active;
          const karaoke = preset.animation === "karaoke";
          if (!spoken && !karaoke) return null;
          return (
            <motion.span
              key={`${lineIndex}-${i}-${preset.id}`}
              animate={current ? ENTER[preset.animation] : undefined}
              transition={{ duration: 0.25 }}
              style={captionTextStyle(preset, karaoke ? spoken : !!word.highlight)}
              className="inline-block"
            >
              {preset.animation === "typewriter" && current ? (
                <Typed text={word.text} ms={wordMs} />
              ) : (
                word.text
              )}
            </motion.span>
          );
        })}
      </div>
    </div>
  );
}

function Typed({ text, ms }: { text: string; ms: number }) {
  const [n, setN] = useState(1);
  useEffect(() => {
    const step = Math.max(30, (ms * 0.7) / text.length);
    const id = setInterval(() => setN((v) => Math.min(text.length, v + 1)), step);
    return () => clearInterval(id);
  }, [text, ms]);
  return <>{text.slice(0, n)}</>;
}
