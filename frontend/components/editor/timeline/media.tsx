"use client";

import { memo, useEffect, useRef } from "react";
import type { Piece } from "@/lib/edit-plan/timeline";
import { PEAKS_PER_SECOND, getPeaks, mediaAspect, mediaStatus, nearestThumb, requestThumbs, useMediaVersion } from "@/lib/editor/media-cache";
import { msToPx, pxToMs } from "@/lib/editor/timeline-view";

/** Source time shown at an output time inside one clip's pieces. */
function srcAt(pieces: Piece[], outMs: number) {
  const p = pieces.find((x) => outMs >= x.outStart && outMs < x.outEnd) ?? pieces[pieces.length - 1];
  return p ? p.srcStart + (Math.min(outMs, p.outEnd) - p.outStart) * p.speed : 0;
}

type StripProps = {
  src: string;
  poster?: string;
  pieces: Piece[];
  outStart: number;
  outEnd: number;
  pps: number;
  from: number;
  to: number;
  height: number;
};

/** Thumbnails along a clip, only for the part on screen. Density follows the zoom. */
export const FilmStrip = memo(function FilmStrip({ src, poster, pieces, outStart, outEnd, pps, from, to, height }: StripProps) {
  useMediaVersion();
  const status = mediaStatus(src);
  const tileW = Math.max(14, Math.round(height * mediaAspect(src)));
  const tileMs = pxToMs(tileW, pps);
  const first = Math.max(0, Math.floor((Math.max(from, outStart) - outStart) / tileMs));
  const last = Math.max(first, Math.ceil((Math.min(to, outEnd) - outStart) / tileMs));
  const tiles: { i: number; srcMs: number }[] = [];
  for (let i = first; i < last && tiles.length < 400; i++) tiles.push({ i, srcMs: srcAt(pieces, outStart + (i + 0.5) * tileMs) });
  const wanted = tiles.map((t) => Math.round(t.srcMs / 100)).join(",");

  useEffect(() => {
    if (status === "failed" || !wanted) return;
    requestThumbs(src, wanted.split(",").map((x) => Number(x) * 100));
  }, [src, wanted, status]);

  return (
    <div
      className="pointer-events-none absolute inset-x-0 top-0 overflow-hidden"
      style={{
        height,
        backgroundImage: poster ? `url(${poster})` : undefined,
        backgroundSize: `${tileW}px ${height}px`,
        backgroundRepeat: "repeat-x",
      }}
      data-filmstrip={status}
    >
      {status !== "failed" &&
        tiles.map(({ i, srcMs }) => {
          const url = nearestThumb(src, srcMs);
          return url ? (
            // eslint-disable-next-line @next/next/no-img-element -- in-memory data URL thumbnail
            <img
              key={i}
              src={url}
              alt=""
              draggable={false}
              className="absolute top-0 object-cover"
              style={{ left: i * tileW, width: tileW, height }}
            />
          ) : null;
        })}
    </div>
  );
});

/** Audio peaks under the filmstrip; a flat line when the clip has no audio (or it can't be decoded). */
export const Waveform = memo(function Waveform({
  src,
  pieces,
  outStart,
  outEnd,
  pps,
  from,
  to,
  height,
  muted,
}: Omit<StripProps, "poster"> & { muted: boolean }) {
  useMediaVersion();
  const peaks = getPeaks(src);
  const ref = useRef<HTMLCanvasElement>(null);
  const visStart = Math.max(from, outStart);
  const visEnd = Math.min(to, outEnd);
  const left = msToPx(visStart - outStart, pps);
  const width = Math.max(0, Math.ceil(msToPx(visEnd - visStart, pps)));

  useEffect(() => {
    const c = ref.current;
    if (!c || !width) return;
    const dpr = window.devicePixelRatio || 1;
    c.width = Math.min(16_000, width * dpr);
    c.height = height * dpr;
    const ctx = c.getContext("2d");
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, width, height);
    const mid = height / 2;
    ctx.fillStyle = muted ? "rgba(29,29,31,.18)" : "rgba(29,29,31,.42)";
    if (!peaks) {
      ctx.fillRect(0, mid - 0.5, width, 1);
      return;
    }
    const step = 2;
    for (let x = 0; x < width; x += step) {
      const a = srcAt(pieces, visStart + pxToMs(x, pps));
      const b = srcAt(pieces, visStart + pxToMs(x + step, pps));
      const i0 = Math.floor((Math.min(a, b) / 1000) * PEAKS_PER_SECOND);
      const i1 = Math.max(i0 + 1, Math.ceil((Math.max(a, b) / 1000) * PEAKS_PER_SECOND));
      let v = 0;
      for (let i = i0; i < i1 && i < peaks.length; i++) v = Math.max(v, peaks[i]);
      const h = Math.max(1, v * (height - 2));
      ctx.fillRect(x, mid - h / 2, step - 0.5, h);
    }
  }, [peaks, pieces, visStart, width, height, pps, muted]);

  return (
    <canvas
      ref={ref}
      aria-hidden
      data-waveform={peaks === undefined ? "loading" : peaks ? "audio" : "none"}
      className="pointer-events-none absolute bottom-0"
      style={{ left, width, height }}
    />
  );
});
