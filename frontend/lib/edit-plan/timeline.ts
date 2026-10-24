import type { Cut, EditPlan, TransitionType, VisualItem, Word, Zoom } from "./schema";

// resolveTimeline(plan) turns an edit plan into everything needed to play it:
// what is on screen at any output time, which words are spoken, how long the
// video is, and how to convert between source and output time.
// It is the only place that knows how clips, speed, cuts, transitions and track
// layers combine, and both
// the editor and the Remotion render read from it, so they cannot disagree.

export type Piece = {
  key: string;
  clipId: string;
  sourceId: string;
  srcStart: number;
  srcEnd: number;
  outStart: number;
  outEnd: number;
  speed: number;
};

export type TimedWord = Word & {
  key: string;
  sourceId: string;
  clipId: string;
  outStart: number;
  outEnd: number;
  display: string;
};

export type CaptionLine = { words: TimedWord[]; start: number; end: number };

export type SourcePoint = { sourceId: string; clipId: string; srcMs: number };

/** Where a clip sits in output time (clips play back to back). */
export type ClipSpan = { clipId: string; outStart: number; outEnd: number };

/** A transition centred on the cut between two clips, at output time `atMs`. */
export type TransitionCue = { fromClipId: string; toClipId: string; atMs: number; type: Exclude<TransitionType, "none">; durationMs: number };

/** A visible track item; higher `layer` is drawn on top. */
export type LayeredItem = { item: VisualItem; trackId: string; layer: number };

/** A sound effect to play, in output time. */
export type SfxCue = {
  itemId: string;
  trackId: string;
  sfxId: string;
  startMs: number;
  endMs: number;
  volume: number;
  fadeInMs: number;
  fadeOutMs: number;
};

export type ResolvedTimeline = {
  durationMs: number;
  pieces: Piece[];
  words: TimedWord[];
  lines: CaptionLine[];
  toOutput: (sourceId: string, srcMs: number) => number | null;
  /** Like toOutput, but a cut-away moment snaps to the next kept moment. */
  toOutputNearest: (sourceId: string, srcMs: number) => number;
  toSource: (outMs: number) => SourcePoint | null;
  zoomAt: (outMs: number) => { scale: number; focusX: number; focusY: number } | null;
  clipSpans: ClipSpan[];
  transitions: TransitionCue[];
  /** Visible text/element/image items at an output time, bottom layer first. */
  itemsAt: (outMs: number) => LayeredItem[];
  /** Sound effects on unmuted, visible SFX tracks that start inside the video. */
  sfxCues: SfxCue[];
};

const MIN_PIECE_MS = 80;
const LINE_GAP_MS = 600;
const LINE_TAIL_MS = 700;

/* ---------- cuts (source time) ---------- */

export function isCutActive(plan: EditPlan, cut: Cut) {
  return cut.reason === "manual" || (plan.cuts[cut.reason] && !plan.cuts.restored.includes(cut.id));
}

export function activeCuts(plan: EditPlan, sourceId?: string): Cut[] {
  return plan.cuts.items
    .filter((c) => (!sourceId || c.sourceId === sourceId) && isCutActive(plan, c))
    .sort((a, b) => a.startMs - b.startMs);
}

export function cutForWord(plan: EditPlan, sourceId: string, word: Word): Cut | undefined {
  const mid = (word.startMs + word.endMs) / 2;
  return plan.cuts.items.find((c) => c.sourceId === sourceId && mid >= c.startMs && mid <= c.endMs);
}

export function isWordCut(plan: EditPlan, sourceId: string, word: Word) {
  const mid = (word.startMs + word.endMs) / 2;
  return activeCuts(plan, sourceId).some((c) => mid >= c.startMs && mid <= c.endMs);
}

export function keptRanges(plan: EditPlan, sourceId: string, from: number, to: number): [number, number][] {
  const ranges: [number, number][] = [];
  let cursor = from;
  for (const c of activeCuts(plan, sourceId)) {
    if (c.endMs <= cursor || c.startMs >= to) continue;
    if (c.startMs > cursor) ranges.push([cursor, Math.min(c.startMs, to)]);
    cursor = Math.max(cursor, c.endMs);
  }
  if (cursor < to) ranges.push([cursor, to]);
  return ranges.filter(([s, e]) => e - s >= MIN_PIECE_MS);
}

/* ---------- zoom curve ---------- */

function zoomAmount(z: Zoom, srcMs: number) {
  const len = z.endMs - z.startMs;
  const p = srcMs - z.startMs;
  const ramp = (ms: number) => {
    const edge = Math.min(ms, len / 2);
    const up = edge ? Math.min(1, p / edge) : 1;
    const down = edge ? Math.min(1, (len - p) / edge) : 1;
    return Math.max(0, Math.min(up, down));
  };
  switch (z.style) {
    case "punch":
      return ramp(90);
    case "linear":
      return ramp(300);
    case "smooth": {
      const v = ramp(450);
      return v * v * (3 - 2 * v);
    }
    case "push": {
      // Slow push across the whole zoom, quick release at the end.
      const release = Math.min(1, (len - p) / Math.min(200, len / 2));
      return Math.max(0, Math.min(p / len, release));
    }
  }
}

/* ---------- captions ---------- */

export function captionLines(words: TimedWord[], perLine: number): CaptionLine[] {
  const lines: CaptionLine[] = [];
  let current: TimedWord[] = [];
  words.forEach((w, i) => {
    const prev = words[i - 1];
    if (current.length >= perLine || (prev && w.outStart - prev.outEnd > LINE_GAP_MS)) {
      lines.push({ words: current, start: current[0].outStart, end: 0 });
      current = [];
    }
    current.push(w);
  });
  if (current.length) lines.push({ words: current, start: current[0].outStart, end: 0 });
  lines.forEach((l, i) => {
    const lastWord = l.words[l.words.length - 1];
    const next = lines[i + 1];
    l.end = next ? Math.min(next.start, lastWord.outEnd + LINE_TAIL_MS) : lastWord.outEnd + LINE_TAIL_MS;
  });
  return lines;
}

/* ---------- resolver ---------- */

function resolve(plan: EditPlan, original: boolean): ResolvedTimeline {
  const sources = new Map(plan.sources.map((s) => [s.id, s]));
  const pieces: Piece[] = [];
  let out = 0;

  if (original) {
    const s = plan.sources[0];
    pieces.push({ key: "original", clipId: "original", sourceId: s.id, srcStart: 0, srcEnd: s.durationMs, outStart: 0, outEnd: s.durationMs, speed: 1 });
    out = s.durationMs;
  } else {
    for (const clip of plan.clips) {
      for (const [srcStart, srcEnd] of keptRanges(plan, clip.sourceId, clip.inMs, clip.outMs)) {
        const len = (srcEnd - srcStart) / clip.speed;
        pieces.push({
          key: `${clip.id}:${srcStart}`,
          clipId: clip.id,
          sourceId: clip.sourceId,
          srcStart,
          srcEnd,
          outStart: out,
          outEnd: out + len,
          speed: clip.speed,
        });
        out += len;
      }
    }
  }

  const words: TimedWord[] = [];
  for (const piece of pieces) {
    const source = sources.get(piece.sourceId);
    if (!source) continue;
    for (const w of source.words) {
      const mid = (w.startMs + w.endMs) / 2;
      if (mid < piece.srcStart || mid >= piece.srcEnd) continue;
      if (!original && isWordCut(plan, piece.sourceId, w)) continue;
      const outStart = piece.outStart + (Math.max(w.startMs, piece.srcStart) - piece.srcStart) / piece.speed;
      const outEnd = piece.outStart + (Math.min(w.endMs, piece.srcEnd) - piece.srcStart) / piece.speed;
      words.push({
        ...w,
        key: `${piece.key}:${w.id}`,
        sourceId: piece.sourceId,
        clipId: piece.clipId,
        outStart,
        outEnd,
        display: plan.captions.edits[w.id] ?? w.text,
      });
    }
  }

  const toSource = (outMs: number): SourcePoint | null => {
    const p = pieces.find((p) => outMs >= p.outStart && outMs < p.outEnd) ?? (outMs >= out ? pieces[pieces.length - 1] : undefined);
    if (!p) return null;
    const srcMs = Math.min(p.srcEnd, p.srcStart + (Math.min(outMs, p.outEnd) - p.outStart) * p.speed);
    return { sourceId: p.sourceId, clipId: p.clipId, srcMs };
  };

  const toOutput = (sourceId: string, srcMs: number) => {
    const p = pieces.find((p) => p.sourceId === sourceId && srcMs >= p.srcStart && srcMs < p.srcEnd);
    return p ? p.outStart + (srcMs - p.srcStart) / p.speed : null;
  };

  const toOutputNearest = (sourceId: string, srcMs: number) => {
    const exact = toOutput(sourceId, srcMs);
    if (exact !== null) return exact;
    const next = pieces.find((p) => p.sourceId === sourceId && p.srcStart >= srcMs);
    return next ? next.outStart : out;
  };

  const zoomAt = (outMs: number) => {
    if (original || !plan.zooms.enabled) return null;
    const at = toSource(outMs);
    if (!at) return null;
    const z = plan.zooms.items.find((z) => z.sourceId === at.sourceId && at.srcMs >= z.startMs && at.srcMs <= z.endMs);
    if (!z) return null;
    return { scale: 1 + (z.scale - 1) * zoomAmount(z, at.srcMs), focusX: z.focusX, focusY: z.focusY };
  };

  const clipSpans: ClipSpan[] = [];
  for (const p of pieces) {
    const last = clipSpans[clipSpans.length - 1];
    if (last?.clipId === p.clipId) last.outEnd = p.outEnd;
    else clipSpans.push({ clipId: p.clipId, outStart: p.outStart, outEnd: p.outEnd });
  }

  const clipById = new Map(plan.clips.map((c) => [c.id, c]));
  const transitions: TransitionCue[] = [];
  if (!original) {
    clipSpans.forEach((a, i) => {
      const b = clipSpans[i + 1];
      const t = clipById.get(a.clipId)?.transition;
      if (!b || !t || t.type === "none") return;
      // Half the transition plays on each side of the cut, so it can't outlast either clip.
      const durationMs = Math.min(t.durationMs, (a.outEnd - a.outStart) * 2, (b.outEnd - b.outStart) * 2);
      if (durationMs > 0) transitions.push({ fromClipId: a.clipId, toClipId: b.clipId, atMs: a.outEnd, type: t.type, durationMs });
    });
  }

  const layered: LayeredItem[] = [];
  const sfxCues: SfxCue[] = [];
  if (!original) {
    for (const track of plan.tracks) {
      if (track.hidden) continue;
      for (const item of track.items) {
        if (item.startMs >= out || item.endMs <= item.startMs) continue;
        if (item.kind === "sfx") {
          if (!track.muted) {
            const { id: itemId, sfxId, startMs, endMs, volume, fadeInMs, fadeOutMs } = item;
            sfxCues.push({ itemId, trackId: track.id, sfxId, startMs, endMs: Math.min(endMs, out), volume, fadeInMs, fadeOutMs });
          }
        } else layered.push({ item, trackId: track.id, layer: layered.length });
      }
    }
  }
  const itemsAt = (outMs: number) => layered.filter(({ item }) => outMs >= item.startMs && outMs < item.endMs);

  return {
    durationMs: out,
    pieces,
    words,
    lines: captionLines(words, plan.captions.wordsPerLine),
    toOutput,
    toOutputNearest,
    toSource,
    zoomAt,
    clipSpans,
    transitions,
    itemsAt,
    sfxCues,
  };
}

// Plans are immutable (every edit makes a new object), so caching by identity is safe.
const cache = new WeakMap<EditPlan, ResolvedTimeline>();
const originalCache = new WeakMap<EditPlan, ResolvedTimeline>();

export function resolveTimeline(plan: EditPlan, opts: { original?: boolean } = {}): ResolvedTimeline {
  const store = opts.original ? originalCache : cache;
  let tl = store.get(plan);
  if (!tl) {
    tl = resolve(plan, !!opts.original);
    store.set(plan, tl);
  }
  return tl;
}

/* ---------- formatting ---------- */

export function msToFrames(ms: number, fps: number) {
  return Math.round((ms / 1000) * fps);
}

export function formatTime(ms: number, withTenths = false) {
  const total = Math.max(0, ms) / 1000;
  const m = Math.floor(total / 60);
  const s = Math.floor(total % 60);
  const base = `${m}:${String(s).padStart(2, "0")}`;
  return withTenths ? `${base}.${Math.floor((total % 1) * 10)}` : base;
}
