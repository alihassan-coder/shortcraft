import {
  ASPECT_SIZES,
  DEFAULT_TRANSFORM,
  ItemSchema,
  NO_ANIMATION,
  ProgressBarSchema,
  TEXT_EFFECT_DEFAULTS,
  TRACK_NAMES,
  type AnimationPhase,
  type Aspect,
  type Canvas,
  type Clip,
  type EditPlan,
  type Element,
  type Item,
  type LoopAnimation,
  type ProgressBar,
  type TextStyle,
  type Track,
  type TrackKind,
  type Transform,
  type Transition,
  type Zoom,
} from "./schema";
import { sfxById } from "./sfx-library";
import { presetById, presetTextStyle } from "./text-styles";
import { cutForWord, resolveTimeline } from "./timeline";

// applyEdit(plan, command) is the only way an edit plan changes.
// The editor UI and the AI Director both speak these commands, undo/redo
// works on the resulting plans, and every rule lives here, testable without UI.
// Invalid commands return the SAME plan object, so no empty undo step is made.

type Patch<T> = Partial<T>;

type EffectKey = "gradient" | "stroke" | "shadow" | "background";

/** Style patch: flat fields replace, effects merge, `null` turns an effect off. */
export type TextStylePatch = Patch<Omit<TextStyle, EffectKey>> & {
  [K in EffectKey]?: Patch<NonNullable<TextStyle[K]>> | null;
};

export type AnimationPatch = { in?: Patch<AnimationPhase>; out?: Patch<AnimationPhase>; loop?: LoopAnimation };

/** Same `type` merges fields; a different `type` must be a complete element. */
export type ElementPatch = { type?: Element["type"] } & Patch<Omit<Extract<Element, { type: "shape" }>, "type">> & {
    emoji?: string;
    stickerId?: string;
  };

/** One patch shape for every item kind; fields that don't apply to the item's kind are ignored. */
export type ItemPatch = {
  startMs?: number;
  endMs?: number;
  transform?: Patch<Transform>;
  animation?: AnimationPatch;
  // text
  text?: string;
  presetId?: string;
  style?: TextStylePatch;
  // element
  element?: ElementPatch;
  // image
  src?: string;
  width?: number;
  // sfx
  sfxId?: string;
  volume?: number;
  fadeInMs?: number;
  fadeOutMs?: number;
};

export type TrackPatch = Patch<Pick<Track, "name" | "locked" | "hidden" | "muted">>;

export type EditCommand =
  // Project
  | { type: "setTitle"; title: string }
  | { type: "setVibe"; vibe: EditPlan["vibe"] }
  | { type: "setCanvas"; canvas: Patch<Canvas> & { aspect?: Aspect } }
  // Clips (basic editing)
  | { type: "splitAt"; outMs: number }
  | { type: "trimClip"; clipId: string; edge: "in" | "out"; srcMs: number }
  | { type: "deleteClips"; clipIds: string[] }
  | { type: "moveClip"; clipId: string; toIndex: number }
  | { type: "duplicateClip"; clipId: string }
  | {
      type: "updateClip";
      clipId: string;
      patch: Patch<Pick<Clip, "speed" | "volume" | "muted" | "audioDetached">> & {
        frame?: Patch<Clip["frame"]>;
        crop?: Patch<Clip["crop"]>;
        color?: Patch<Clip["color"]>;
        animation?: Omit<AnimationPatch, "loop">;
      };
    }
  /** Transition from this clip into the next. `null` or type "none" removes it. */
  | { type: "setTransition"; clipId: string; transition: Patch<Transition> | null }
  // Cuts & transcript
  | { type: "setCutRules"; rules: Patch<Pick<EditPlan["cuts"], "silence" | "filler" | "retake">> }
  | { type: "toggleRestoreCut"; cutId: string }
  | { type: "removeCut"; cutId: string }
  | { type: "cutRange"; sourceId: string; startMs: number; endMs: number; note?: string }
  | { type: "toggleWordCut"; sourceId: string; wordId: string }
  | { type: "setWordText"; wordId: string; text: string }
  // Captions
  | { type: "setCaptions"; captions: Patch<Omit<EditPlan["captions"], "highlights" | "emojis" | "edits">> }
  | { type: "toggleHighlight"; wordId: string }
  | { type: "setEmoji"; wordId: string; emoji: string | null }
  // Zoom
  | { type: "setZoomsEnabled"; enabled: boolean }
  | { type: "addZoom"; sourceId: string; atMs: number; zoom?: Patch<Zoom> }
  | { type: "updateZoom"; zoomId: string; patch: Patch<Omit<Zoom, "id" | "sourceId">> }
  | { type: "updateAllZooms"; patch: Patch<Pick<Zoom, "style" | "scale">> }
  | { type: "removeZoom"; zoomId: string }
  // Tracks & items (output time). Items on locked tracks can't be changed.
  /** Adds to `trackId`, else the top unlocked track of that kind, else a new track. */
  | { type: "addItem"; trackKind: TrackKind; trackId?: string; atMs?: number; item?: ItemPatch & { id?: string } }
  | { type: "updateItem"; itemId: string; patch: ItemPatch }
  | { type: "removeItems"; itemIds: string[] }
  /** Keeps the item's length; the start is clamped so it ends inside the video. */
  | { type: "moveItem"; itemId: string; toTrackId?: string; startMs?: number }
  | { type: "trimItem"; itemId: string; edge: "start" | "end"; ms: number }
  /** Copies sit at the same time (visual items nudged down) or right after (sfx). */
  | { type: "duplicateItems"; itemIds: string[]; newIds?: string[] }
  | { type: "addTrack"; kind: TrackKind; trackId?: string; name?: string; index?: number }
  | { type: "removeTrack"; trackId: string }
  | { type: "reorderTrack"; trackId: string; toIndex: number }
  | { type: "updateTrack"; trackId: string; patch: TrackPatch }
  | { type: "setProgressBar"; bar: Patch<ProgressBar> }
  // Audio & hook
  | { type: "setMusic"; music: Patch<EditPlan["music"]> }
  | { type: "setVoice"; voice: Patch<EditPlan["voice"]> }
  | { type: "setHook"; hook: Patch<EditPlan["hook"]> };

const MIN_CLIP_MS = 100;
export const MIN_ITEM_MS = 100;
/** New items never start closer than this to the end of the video. */
const ADD_ROOM_MS = 500;
const DEFAULT_TRANSITION: Transition = { type: "fade", durationMs: 400 };

let counter = 0;
export const newId = (prefix: string) => `${prefix}-${Date.now().toString(36)}${(counter++).toString(36)}`;

export const VIBE_DEFAULTS: Record<EditPlan["vibe"], { presetId: string; trackId: string }> = {
  energetic: { presetId: "bold-pop", trackId: "summer-fun" },
  clean: { presetId: "clean", trackId: "just-chill" },
  story: { presetId: "story", trackId: "a-new-life" },
};

export function applyEdit(plan: EditPlan, cmd: EditCommand): EditPlan {
  const p = structuredClone(plan);
  const changed = mutate(p, cmd, plan);
  return changed ? p : plan;
}

export function applyEdits(plan: EditPlan, cmds: EditCommand[]): EditPlan {
  return cmds.reduce(applyEdit, plan);
}

// Returns false when the command does nothing.
function mutate(p: EditPlan, cmd: EditCommand, before: EditPlan): boolean {
  const clipIndex = (id: string) => p.clips.findIndex((c) => c.id === id);
  const sourceOf = (sourceId: string) => p.sources.find((s) => s.id === sourceId);

  switch (cmd.type) {
    case "setTitle":
      p.title = cmd.title;
      return true;

    case "setVibe": {
      const d = VIBE_DEFAULTS[cmd.vibe];
      p.vibe = cmd.vibe;
      p.captions.presetId = d.presetId;
      if (p.music.trackId) p.music.trackId = d.trackId;
      return true;
    }

    case "setCanvas": {
      Object.assign(p.canvas, cmd.canvas);
      const aspect = cmd.canvas.aspect;
      if (aspect && aspect !== "custom" && !cmd.canvas.width && !cmd.canvas.height) {
        Object.assign(p.canvas, ASPECT_SIZES[aspect]);
      }
      if (cmd.canvas.width || cmd.canvas.height) {
        const match = (Object.entries(ASPECT_SIZES) as [Aspect, { width: number; height: number }][]).find(
          ([, s]) => s.width * p.canvas.height === s.height * p.canvas.width,
        );
        if (!cmd.canvas.aspect) p.canvas.aspect = match ? match[0] : "custom";
      }
      p.canvas.width = Math.round(Math.min(4096, Math.max(240, p.canvas.width)) / 2) * 2;
      p.canvas.height = Math.round(Math.min(4096, Math.max(240, p.canvas.height)) / 2) * 2;
      return true;
    }

    case "splitAt": {
      const at = resolveTimeline(before).toSource(cmd.outMs);
      if (!at) return false;
      const i = clipIndex(at.clipId);
      const clip = p.clips[i];
      if (!clip || at.srcMs - clip.inMs < MIN_CLIP_MS || clip.outMs - at.srcMs < MIN_CLIP_MS) return false;
      const right: Clip = { ...structuredClone(clip), id: newId("clip"), inMs: at.srcMs };
      clip.outMs = at.srcMs;
      p.clips.splice(i + 1, 0, right);
      return true;
    }

    case "trimClip": {
      const clip = p.clips[clipIndex(cmd.clipId)];
      const source = clip && sourceOf(clip.sourceId);
      if (!clip || !source) return false;
      if (cmd.edge === "in") clip.inMs = Math.max(0, Math.min(cmd.srcMs, clip.outMs - MIN_CLIP_MS));
      else clip.outMs = Math.min(source.durationMs, Math.max(cmd.srcMs, clip.inMs + MIN_CLIP_MS));
      return true;
    }

    case "deleteClips": {
      const keep = p.clips.filter((c) => !cmd.clipIds.includes(c.id));
      if (keep.length === p.clips.length || keep.length === 0) return false;
      p.clips = keep;
      return true;
    }

    case "moveClip": {
      const from = clipIndex(cmd.clipId);
      const to = Math.max(0, Math.min(p.clips.length - 1, cmd.toIndex));
      if (from < 0 || from === to) return false;
      const [clip] = p.clips.splice(from, 1);
      p.clips.splice(to, 0, clip);
      return true;
    }

    case "duplicateClip": {
      const i = clipIndex(cmd.clipId);
      if (i < 0) return false;
      p.clips.splice(i + 1, 0, { ...structuredClone(p.clips[i]), id: newId("clip") });
      return true;
    }

    case "updateClip": {
      const clip = p.clips[clipIndex(cmd.clipId)];
      if (!clip) return false;
      const { frame, crop, color, animation, ...rest } = cmd.patch;
      Object.assign(clip, defined(rest));
      if (frame) Object.assign(clip.frame, defined(frame));
      if (crop) Object.assign(clip.crop, defined(crop));
      if (color) Object.assign(clip.color, defined(color));
      if (animation?.in) Object.assign(clip.animation.in, defined(animation.in));
      if (animation?.out) Object.assign(clip.animation.out, defined(animation.out));
      clip.speed = clamp(clip.speed, 0.25, 4);
      clip.frame.opacity = clamp(clip.frame.opacity, 0, 1);
      for (const phase of [clip.animation.in, clip.animation.out]) phase.durationMs = clamp(phase.durationMs, 0, 5000);
      return true;
    }

    case "setCutRules":
      Object.assign(p.cuts, cmd.rules);
      return true;

    case "toggleRestoreCut": {
      const cut = p.cuts.items.find((c) => c.id === cmd.cutId);
      if (!cut || cut.reason === "manual") return false;
      const r = p.cuts.restored;
      p.cuts.restored = r.includes(cut.id) ? r.filter((x) => x !== cut.id) : [...r, cut.id];
      return true;
    }

    case "removeCut": {
      const before = p.cuts.items.length;
      p.cuts.items = p.cuts.items.filter((c) => c.id !== cmd.cutId);
      return p.cuts.items.length !== before;
    }

    case "cutRange":
      if (cmd.endMs - cmd.startMs <= 0) return false;
      p.cuts.items.push({ id: newId("manual"), sourceId: cmd.sourceId, startMs: cmd.startMs, endMs: cmd.endMs, reason: "manual", note: cmd.note });
      return true;

    case "toggleWordCut": {
      const word = sourceOf(cmd.sourceId)?.words.find((w) => w.id === cmd.wordId);
      if (!word) return false;
      const cut = cutForWord(p, cmd.sourceId, word);
      const manual = () =>
        p.cuts.items.push({ id: newId("manual"), sourceId: cmd.sourceId, startMs: word.startMs, endMs: word.endMs, reason: "manual" });
      if (!cut) manual();
      else if (cut.reason === "manual") p.cuts.items = p.cuts.items.filter((c) => c.id !== cut.id);
      else if (p.cuts.restored.includes(cut.id) || !p.cuts[cut.reason]) manual();
      else p.cuts.restored.push(cut.id);
      return true;
    }

    case "setWordText": {
      const original = p.sources.flatMap((s) => s.words).find((w) => w.id === cmd.wordId)?.text;
      if (original === undefined) return false;
      const text = cmd.text.trim();
      if (!text || text === original) delete p.captions.edits[cmd.wordId];
      else p.captions.edits[cmd.wordId] = text;
      return true;
    }

    case "setCaptions":
      Object.assign(p.captions, cmd.captions);
      return true;

    case "toggleHighlight": {
      const h = p.captions.highlights;
      p.captions.highlights = h.includes(cmd.wordId) ? h.filter((x) => x !== cmd.wordId) : [...h, cmd.wordId];
      return true;
    }

    case "setEmoji":
      if (cmd.emoji) p.captions.emojis[cmd.wordId] = cmd.emoji;
      else delete p.captions.emojis[cmd.wordId];
      return true;

    case "setZoomsEnabled":
      p.zooms.enabled = cmd.enabled;
      return true;

    case "addZoom": {
      const source = sourceOf(cmd.sourceId);
      if (!source) return false;
      const len = 1400;
      const start = Math.max(0, Math.min(cmd.atMs, source.durationMs - len));
      p.zooms.items.push({
        id: newId("zoom"),
        sourceId: cmd.sourceId,
        startMs: start,
        endMs: start + len,
        scale: 1.2,
        style: "punch",
        focusX: 0.5,
        focusY: 0.33,
        ...cmd.zoom,
      });
      p.zooms.items.sort((a, b) => a.startMs - b.startMs);
      p.zooms.enabled = true;
      return true;
    }

    case "updateZoom": {
      const z = p.zooms.items.find((z) => z.id === cmd.zoomId);
      if (!z) return false;
      Object.assign(z, cmd.patch);
      if (z.endMs - z.startMs < 200) z.endMs = z.startMs + 200;
      p.zooms.items.sort((a, b) => a.startMs - b.startMs);
      return true;
    }

    case "updateAllZooms":
      p.zooms.items.forEach((z) => Object.assign(z, cmd.patch));
      return p.zooms.items.length > 0;

    case "removeZoom": {
      const before = p.zooms.items.length;
      p.zooms.items = p.zooms.items.filter((z) => z.id !== cmd.zoomId);
      return p.zooms.items.length !== before;
    }

    case "addItem":
    case "updateItem":
    case "removeItems":
    case "moveItem":
    case "trimItem":
    case "duplicateItems":
    case "addTrack":
    case "removeTrack":
    case "reorderTrack":
    case "updateTrack":
      return mutateTracks(p, cmd, resolveTimeline(before).durationMs);

    case "setTransition": {
      const i = clipIndex(cmd.clipId);
      // A transition leads into the next clip, so the last clip can't have one.
      if (i < 0 || i === p.clips.length - 1) return false;
      const clip = p.clips[i];
      if (!cmd.transition || cmd.transition.type === "none") {
        if (!clip.transition) return false;
        delete clip.transition;
        return true;
      }
      const t = { ...(clip.transition ?? DEFAULT_TRANSITION), ...defined(cmd.transition) };
      clip.transition = { type: t.type, durationMs: clamp(t.durationMs, 0, 2000) };
      return true;
    }

    case "setProgressBar":
      Object.assign(p.progressBar, defined(cmd.bar));
      p.progressBar.thickness = clamp(p.progressBar.thickness, 2, 60);
      return ProgressBarSchema.safeParse(p.progressBar).success;

    case "setMusic":
      Object.assign(p.music, cmd.music);
      return true;

    case "setVoice":
      Object.assign(p.voice, cmd.voice);
      return true;

    case "setHook":
      Object.assign(p.hook, cmd.hook);
      return true;
  }
}

/* ---------- tracks & items ---------- */

const clamp = (v: number, min: number, max: number) => Math.min(max, Math.max(min, v));

/** Drops `undefined` values so a patch can't blank out required fields. */
function defined<T extends object>(patch: T): Partial<T> {
  return Object.fromEntries(Object.entries(patch).filter(([, v]) => v !== undefined)) as Partial<T>;
}

type TrackCommand = Extract<
  EditCommand,
  {
    type:
      | "addItem"
      | "updateItem"
      | "removeItems"
      | "moveItem"
      | "trimItem"
      | "duplicateItems"
      | "addTrack"
      | "removeTrack"
      | "reorderTrack"
      | "updateTrack";
  }
>;

const DEFAULT_LENGTH: Record<TrackKind, number> = { text: 2500, element: 2000, image: 3000, sfx: 1000 };

function newTrack(kind: TrackKind, id = newId("track"), name = TRACK_NAMES[kind]): Track {
  return { id, kind, name, locked: false, hidden: false, muted: false, items: [] };
}

function defaultItem(kind: TrackKind, id: string): Item {
  const visual = {
    id,
    startMs: 0,
    endMs: DEFAULT_LENGTH[kind],
    transform: { ...DEFAULT_TRANSFORM },
    animation: { in: { type: "pop" as const, durationMs: 220 }, out: { type: "pop" as const, durationMs: 200 }, loop: "none" as const },
  };
  switch (kind) {
    case "text":
      return {
        ...visual,
        kind,
        text: "Your text",
        presetId: "clean",
        style: presetTextStyle(presetById("clean")),
        transform: { ...visual.transform, y: 0.3 },
      };
    case "element":
      return { ...visual, kind, element: { type: "emoji", emoji: "🔥" } };
    case "image":
      return { ...visual, kind, src: "", width: 0.3, animation: { in: { ...NO_ANIMATION }, out: { ...NO_ANIMATION }, loop: "none" } };
    case "sfx":
      return { id, kind, startMs: 0, endMs: DEFAULT_LENGTH.sfx, sfxId: "whoosh", volume: 1, fadeInMs: 0, fadeOutMs: 0 };
  }
}

function mergeEffect<K extends EffectKey>(style: TextStyle, key: K, value: Patch<NonNullable<TextStyle[K]>> | null | undefined) {
  if (value === undefined) return;
  if (value === null) delete style[key];
  else style[key] = { ...(style[key] ?? TEXT_EFFECT_DEFAULTS[key]), ...defined(value) } as TextStyle[K];
}

const FLAT_FIELDS: Record<TrackKind, readonly (keyof ItemPatch)[]> = {
  text: ["text", "presetId"],
  element: [],
  image: ["src", "width"],
  sfx: ["sfxId", "volume", "fadeInMs", "fadeOutMs"],
};

/** Applies everything except timing. Returns false if the result isn't a valid item. */
function patchItem(item: Item, patch: ItemPatch): boolean {
  const flat = patch as Record<string, unknown>;
  const target = item as Record<string, unknown>;
  for (const k of FLAT_FIELDS[item.kind]) if (flat[k] !== undefined) target[k] = flat[k];

  if (item.kind !== "sfx") {
    const { transform, animation } = patch;
    if (transform) Object.assign(item.transform, defined(transform));
    if (animation?.in) Object.assign(item.animation.in, defined(animation.in));
    if (animation?.out) Object.assign(item.animation.out, defined(animation.out));
    if (animation?.loop) item.animation.loop = animation.loop;
    const t = item.transform;
    t.x = clamp(t.x, 0, 1);
    t.y = clamp(t.y, 0, 1);
    t.scale = clamp(t.scale, 0.05, 10);
    t.opacity = clamp(t.opacity, 0, 1);
    t.rotation = clamp(t.rotation, -360, 360);
    for (const phase of [item.animation.in, item.animation.out]) phase.durationMs = clamp(phase.durationMs, 0, 5000);
  }

  if (item.kind === "text" && patch.style) {
    const { gradient, stroke, shadow, background, ...rest } = patch.style;
    Object.assign(item.style, defined(rest));
    mergeEffect(item.style, "gradient", gradient);
    mergeEffect(item.style, "stroke", stroke);
    mergeEffect(item.style, "shadow", shadow);
    mergeEffect(item.style, "background", background);
  }

  if (item.kind === "element" && patch.element) {
    const e = defined(patch.element);
    item.element = (e.type && e.type !== item.element.type ? e : { ...item.element, ...e }) as Element;
  }

  return ItemSchema.safeParse(item).success;
}

/** Sets one edge of an item, keeping it at least MIN_ITEM_MS long and inside [0, duration]. */
function setEdge(item: Item, edge: "start" | "end", ms: number, durationMs: number) {
  if (edge === "start") item.startMs = clamp(ms, 0, item.endMs - MIN_ITEM_MS);
  else item.endMs = Math.max(item.startMs + MIN_ITEM_MS, Math.min(ms, durationMs));
}

const sortItems = (track: Track) => track.items.sort((a, b) => a.startMs - b.startMs);

function mutateTracks(p: EditPlan, cmd: TrackCommand, durationMs: number): boolean {
  const trackById = (id: string) => p.tracks.find((t) => t.id === id);
  const find = (itemId: string) => {
    for (const track of p.tracks) {
      const item = track.items.find((i) => i.id === itemId);
      if (item) return { track, item };
    }
    return null;
  };
  // Only items on unlocked tracks can be edited.
  const editable = (itemId: string) => {
    const hit = find(itemId);
    return hit && !hit.track.locked ? hit : null;
  };

  switch (cmd.type) {
    case "addItem": {
      let track = cmd.trackId
        ? trackById(cmd.trackId)
        : [...p.tracks].reverse().find((t) => t.kind === cmd.trackKind && !t.locked);
      if (cmd.trackId && (!track || track.kind !== cmd.trackKind || track.locked)) return false;
      if (!track) {
        track = newTrack(cmd.trackKind);
        p.tracks.push(track);
      }
      const { id, startMs, endMs, ...rest } = cmd.item ?? {};
      if (id && find(id)) return false;
      const item = defaultItem(cmd.trackKind, id ?? newId(cmd.trackKind));
      if (!patchItem(item, rest)) return false;
      const fallbackLength =
        item.kind === "sfx" ? (sfxById(item.sfxId)?.durationMs ?? DEFAULT_LENGTH.sfx) : DEFAULT_LENGTH[item.kind];
      const start = clamp(cmd.atMs ?? startMs ?? 0, 0, Math.max(0, durationMs - ADD_ROOM_MS));
      const length = endMs !== undefined && startMs !== undefined ? endMs - startMs : fallbackLength;
      item.startMs = start;
      item.endMs = Math.max(start + MIN_ITEM_MS, Math.min(durationMs, start + length));
      track.items.push(item);
      sortItems(track);
      return true;
    }

    case "updateItem": {
      const hit = editable(cmd.itemId);
      if (!hit) return false;
      const { startMs, endMs, ...rest } = cmd.patch;
      if (!patchItem(hit.item, rest)) return false;
      if (endMs !== undefined) setEdge(hit.item, "end", endMs, durationMs);
      if (startMs !== undefined) setEdge(hit.item, "start", startMs, durationMs);
      sortItems(hit.track);
      return true;
    }

    case "removeItems": {
      let removed = false;
      for (const track of p.tracks) {
        if (track.locked) continue;
        const keep = track.items.filter((i) => !cmd.itemIds.includes(i.id));
        removed ||= keep.length !== track.items.length;
        track.items = keep;
      }
      return removed;
    }

    case "moveItem": {
      const hit = editable(cmd.itemId);
      if (!hit) return false;
      const { item, track } = hit;
      const target = cmd.toTrackId ? trackById(cmd.toTrackId) : track;
      if (!target || target.kind !== item.kind || target.locked) return false;
      const length = item.endMs - item.startMs;
      const start = clamp(cmd.startMs ?? item.startMs, 0, Math.max(0, durationMs - length));
      if (target === track && start === item.startMs) return false;
      item.startMs = start;
      item.endMs = start + length;
      if (target !== track) {
        track.items = track.items.filter((i) => i !== item);
        target.items.push(item);
      }
      sortItems(target);
      return true;
    }

    case "trimItem": {
      const hit = editable(cmd.itemId);
      if (!hit) return false;
      setEdge(hit.item, cmd.edge, cmd.ms, durationMs);
      sortItems(hit.track);
      return true;
    }

    case "duplicateItems": {
      let added = 0;
      cmd.itemIds.forEach((itemId, n) => {
        const hit = editable(itemId);
        if (!hit) return;
        const copy = { ...structuredClone(hit.item), id: cmd.newIds?.[n] ?? newId(hit.item.kind) };
        if (find(copy.id)) return;
        if (copy.kind === "sfx") {
          const length = copy.endMs - copy.startMs;
          copy.startMs = clamp(hit.item.endMs, 0, Math.max(0, durationMs - length));
          copy.endMs = copy.startMs + length;
        } else {
          copy.transform.y = clamp(copy.transform.y + 0.06, 0, 1);
        }
        hit.track.items.push(copy);
        sortItems(hit.track);
        added++;
      });
      return added > 0;
    }

    case "addTrack": {
      if (cmd.trackId && trackById(cmd.trackId)) return false;
      const track = newTrack(cmd.kind, cmd.trackId, cmd.name?.trim() || undefined);
      p.tracks.splice(clamp(cmd.index ?? p.tracks.length, 0, p.tracks.length), 0, track);
      return true;
    }

    case "removeTrack": {
      const track = trackById(cmd.trackId);
      if (!track || track.locked) return false;
      p.tracks = p.tracks.filter((t) => t !== track);
      return true;
    }

    case "reorderTrack": {
      const from = p.tracks.findIndex((t) => t.id === cmd.trackId);
      const to = clamp(cmd.toIndex, 0, p.tracks.length - 1);
      if (from < 0 || from === to) return false;
      const [track] = p.tracks.splice(from, 1);
      p.tracks.splice(to, 0, track);
      return true;
    }

    case "updateTrack": {
      const track = trackById(cmd.trackId);
      if (!track) return false;
      const patch = defined(cmd.patch);
      if (patch.name !== undefined && !patch.name.trim()) delete patch.name;
      Object.assign(track, patch);
      return true;
    }
  }
}
