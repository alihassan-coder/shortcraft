"use client";

import type { SpriteIndex } from "@/lib/api";
import { cn } from "@/lib/utils";

/** One frame of the backend's thumbnail sheet, or the poster captured before upload. */
export function ProjectThumb({
  poster,
  sprite,
  boxAspect = 4 / 5,
  className,
}: {
  poster?: string | null;
  sprite?: { url: string; index: SpriteIndex } | null;
  /** Width / height of the box, so the frame can fill it (like object-fit: cover). */
  boxAspect?: number;
  className?: string;
}) {
  let frame: React.ReactNode = null;
  // The captured poster is sharper (320 px) than a sprite cell (160 px), so it wins.
  if (poster) {
    // eslint-disable-next-line @next/next/no-img-element -- data URL from this browser
    frame = <img src={poster} alt="" className="absolute inset-0 size-full object-cover" />;
  } else if (sprite && sprite.index.count > 0) {
    const { index } = sprite;
    const f = index.frames[Math.min(1, index.frames.length - 1)] ?? { x: 0, y: 0 };
    const col = Math.round(f.x / index.width);
    const row = Math.round(f.y / index.height);
    const taller = index.width / index.height < boxAspect;
    frame = (
      <div
        aria-hidden
        className={cn(
          "absolute",
          taller ? "inset-x-0 top-1/2 w-full -translate-y-1/2" : "inset-y-0 left-1/2 h-full -translate-x-1/2",
        )}
        style={{
          aspectRatio: `${index.width} / ${index.height}`,
          backgroundImage: `url("${sprite.url}")`,
          backgroundSize: `${index.columns * 100}% ${index.rows * 100}%`,
          backgroundPosition: `${index.columns > 1 ? (col / (index.columns - 1)) * 100 : 0}% ${index.rows > 1 ? (row / (index.rows - 1)) * 100 : 0}%`,
        }}
      />
    );
  }

  return (
    <div className={cn("relative overflow-hidden bg-[#141416]", className)}>
      {frame ?? (
        <div className="absolute inset-0 grid place-items-center">
          <svg viewBox="0 0 20 28" className="h-10 w-7 opacity-20" aria-hidden>
            <path d="M4 0h12a4 4 0 0 1 4 4v7.2L0 16.6V4a4 4 0 0 1 4-4Z" fill="#fff" />
            <path d="M20 14.4V24a4 4 0 0 1-4 4H4a4 4 0 0 1-4-4v-4.2l20-5.4Z" fill="#fff" />
          </svg>
        </div>
      )}
    </div>
  );
}
