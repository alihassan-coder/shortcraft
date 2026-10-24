"use client";

import { useSyncExternalStore } from "react";
import { useUiStore } from "./store";

// Filmstrip thumbnails and waveform peaks for timeline clips, decoded in the
// browser with mediabunny (WebCodecs). Work is queued per source, done in
// small batches that yield between them, and paused while the video plays, so
// it never competes with playback. Results are cached in memory per source and
// (quantized) source time. If a file can't be decoded the timeline falls back
// to the poster image and a flat waveform.

export const THUMB_HEIGHT = 36; // CSS px; decoded at 2× for sharp screens
const THUMB_QUANTUM_MS = 100;
const BATCH = 8;
export const PEAKS_PER_SECOND = 50;

type Status = "loading" | "ready" | "failed";

type Media = {
  status: Status;
  /** Width / height of the video frame. */
  aspect: number;
  thumbs: Map<number, string>;
  sortedKeys: number[];
  pending: Set<number>;
  pumping: boolean;
  /** undefined = not computed yet, null = no audio. */
  peaks: Float32Array | null | undefined;
  peaksStarted: boolean;
  sink?: import("mediabunny").CanvasSink;
  input?: import("mediabunny").Input;
};

const media = new Map<string, Media>();
let version = 0;
const listeners = new Set<() => void>();
let notifyQueued = false;

function notify() {
  if (notifyQueued) return;
  notifyQueued = true;
  const run = () => {
    notifyQueued = false;
    version++;
    listeners.forEach((l) => l());
  };
  if (typeof requestAnimationFrame === "function") requestAnimationFrame(run);
  else setTimeout(run, 16);
}

const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => listeners.delete(l);
};

/** Re-renders when any thumbnail or waveform arrives. */
export const useMediaVersion = () => useSyncExternalStore(subscribe, () => version, () => 0);

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const isPlaying = () => useUiStore.getState().playing;

function entry(src: string): Media {
  let m = media.get(src);
  if (!m) {
    m = { status: "loading", aspect: 9 / 16, thumbs: new Map(), sortedKeys: [], pending: new Set(), pumping: false, peaks: undefined, peaksStarted: false };
    media.set(src, m);
    void open(src, m);
  }
  return m;
}

async function open(src: string, m: Media) {
  try {
    if (typeof window === "undefined" || typeof VideoDecoder === "undefined") throw new Error("WebCodecs unavailable");
    const mb = await import("mediabunny");
    const input = new mb.Input({ source: new mb.UrlSource(src), formats: mb.ALL_FORMATS });
    const track = await input.getPrimaryVideoTrack();
    if (!track || !(await track.canDecode())) throw new Error("Can't decode video");
    m.aspect = track.displayWidth / track.displayHeight || m.aspect;
    m.input = input;
    m.sink = new mb.CanvasSink(track, { height: THUMB_HEIGHT * 2, fit: "contain" });
    m.status = "ready";
    void pump(src, m);
  } catch {
    m.status = "failed";
    m.peaks ??= null;
  }
  notify();
}

export const quantize = (srcMs: number) => Math.max(0, Math.round(srcMs / THUMB_QUANTUM_MS) * THUMB_QUANTUM_MS);

export function mediaStatus(src: string): Status {
  return entry(src).status;
}

export function mediaAspect(src: string) {
  return entry(src).aspect;
}

/** Queue thumbnails for these source times (ms). */
export function requestThumbs(src: string, srcMs: number[]) {
  const m = entry(src);
  if (m.status === "failed") return;
  let added = false;
  for (const t of srcMs) {
    const k = quantize(t);
    if (!m.thumbs.has(k) && !m.pending.has(k)) {
      m.pending.add(k);
      added = true;
    }
  }
  if (added && m.status === "ready") void pump(src, m);
}

/** The cached thumbnail closest to `srcMs` (within 3 s), or undefined. */
export function nearestThumb(src: string, srcMs: number): string | undefined {
  const m = media.get(src);
  if (!m || !m.sortedKeys.length) return undefined;
  const k = quantize(srcMs);
  const exact = m.thumbs.get(k);
  if (exact) return exact;
  const keys = m.sortedKeys;
  let lo = 0;
  let hi = keys.length - 1;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (keys[mid] < k) lo = mid + 1;
    else hi = mid;
  }
  const near = [keys[lo], keys[lo - 1]].filter((x) => x !== undefined).sort((a, b) => Math.abs(a - k) - Math.abs(b - k))[0];
  return near !== undefined && Math.abs(near - k) <= 3000 ? m.thumbs.get(near) : undefined;
}

function insertKey(keys: number[], k: number) {
  let i = keys.length;
  while (i > 0 && keys[i - 1] > k) i--;
  keys.splice(i, 0, k);
}

async function pump(src: string, m: Media) {
  if (m.pumping || !m.sink) return;
  m.pumping = true;
  try {
    while (m.pending.size) {
      if (isPlaying()) {
        await sleep(400);
        continue;
      }
      const batch = [...m.pending].sort((a, b) => a - b).slice(0, BATCH);
      let i = 0;
      for await (const wrapped of m.sink.canvasesAtTimestamps(batch.map((ms) => ms / 1000))) {
        const k = batch[i++];
        m.pending.delete(k);
        if (!wrapped) continue;
        const c = wrapped.canvas;
        const url =
          "toDataURL" in c
            ? c.toDataURL("image/jpeg", 0.72)
            : URL.createObjectURL(await (c as OffscreenCanvas).convertToBlob({ type: "image/jpeg", quality: 0.72 }));
        if (!m.thumbs.has(k)) insertKey(m.sortedKeys, k);
        m.thumbs.set(k, url);
      }
      batch.forEach((k) => m.pending.delete(k));
      notify();
      await sleep(0);
    }
  } catch {
    // A bad frame shouldn't stop the editor; the poster stays as the fallback.
    m.pending.clear();
  } finally {
    m.pumping = false;
  }
}

/* ---------- waveform ---------- */

/** Peaks (0–1, PEAKS_PER_SECOND per second of source), null if there is no audio, undefined while loading. */
export function getPeaks(src: string): Float32Array | null | undefined {
  const m = entry(src);
  if (!m.peaksStarted && m.status !== "loading") {
    m.peaksStarted = true;
    void computePeaks(m);
  }
  return m.peaks;
}

async function computePeaks(m: Media) {
  try {
    if (!m.input) throw new Error("no input");
    const mb = await import("mediabunny");
    const track = await m.input.getPrimaryAudioTrack();
    if (!track || !(await track.canDecode())) {
      m.peaks = null;
      return;
    }
    const duration = await m.input.computeDuration();
    const peaks = new Float32Array(Math.ceil(duration * PEAKS_PER_SECOND) + 1);
    const sink = new mb.AudioSampleSink(track);
    let n = 0;
    let buf = new Float32Array(0);
    for await (const sample of sink.samples()) {
      const frames = sample.numberOfFrames;
      if (buf.length < frames) buf = new Float32Array(frames);
      sample.copyTo(buf, { planeIndex: 0, format: "f32-planar" });
      const perBucket = sample.sampleRate / PEAKS_PER_SECOND;
      const base = sample.timestamp * sample.sampleRate;
      for (let i = 0; i < frames; i++) {
        const b = Math.floor((base + i) / perBucket);
        const v = Math.abs(buf[i]);
        if (b >= 0 && b < peaks.length && v > peaks[b]) peaks[b] = v;
      }
      sample.close();
      if (++n % 24 === 0) {
        await sleep(isPlaying() ? 50 : 0);
      }
    }
    const max = peaks.reduce((a, b) => Math.max(a, b), 0);
    if (max > 0) for (let i = 0; i < peaks.length; i++) peaks[i] = Math.min(1, peaks[i] / max);
    m.peaks = peaks;
  } catch {
    m.peaks = null;
  } finally {
    notify();
  }
}
