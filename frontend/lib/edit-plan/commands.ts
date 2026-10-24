import {
  ASPECT_SIZES,
  type Aspect,
  type Canvas,
  type Clip,
  type EditPlan,
  type TextOverlay,
  type Zoom,
} from "./schema";
import { cutForWord, resolveTimeline } from "./timeline";

// applyEdit(plan, command) is the only way an edit plan changes.
// The editor UI and the AI Director both speak these commands, undo/redo
// works on the resulting plans, and every rule lives here, testable without UI.
// Invalid commands return the SAME plan object, so no empty undo step is made.

type Patch<T> = Partial<T>;

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
  | { type: "updateClip"; clipId: string; patch: Patch<Pick<Clip, "speed" | "volume" | "muted">> & {
      frame?: Patch<Clip["frame"]>;
      crop?: Patch<Clip["crop"]>;
      color?: Patch<Clip["color"]>;
    } }
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
  // Overlays
  | { type: "addText"; text?: Patch<TextOverlay> }
  | { type: "updateText"; textId: string; patch: Patch<Omit<TextOverlay, "id">> }
  | { type: "removeText"; textId: string }
  | { type: "setProgressBar"; bar: Patch<EditPlan["overlays"]["progressBar"]> }
  // Audio & hook
  | { type: "setMusic"; music: Patch<EditPlan["music"]> }
  | { type: "setVoice"; voice: Patch<EditPlan["voice"]> }
  | { type: "setHook"; hook: Patch<EditPlan["hook"]> };

const MIN_CLIP_MS = 100;

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
      const { frame, crop, color, ...rest } = cmd.patch;
      Object.assign(clip, rest);
      if (frame) Object.assign(clip.frame, frame);
      if (crop) Object.assign(clip.crop, crop);
      if (color) Object.assign(clip.color, color);
      clip.speed = Math.min(4, Math.max(0.25, clip.speed));
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

    case "addText": {
      const duration = resolveTimeline(before).durationMs;
      const start = Math.min(cmd.text?.startMs ?? 0, Math.max(0, duration - 500));
      p.overlays.texts.push({
        id: newId("text"),
        startMs: start,
        endMs: Math.min(duration, start + 2500),
        text: "Your text",
        presetId: "clean",
        x: 0.5,
        y: 0.3,
        size: 72,
        animation: "pop",
        ...cmd.text,
      });
      return true;
    }

    case "updateText": {
      const t = p.overlays.texts.find((t) => t.id === cmd.textId);
      if (!t) return false;
      Object.assign(t, cmd.patch);
      return true;
    }

    case "removeText": {
      const before = p.overlays.texts.length;
      p.overlays.texts = p.overlays.texts.filter((t) => t.id !== cmd.textId);
      return p.overlays.texts.length !== before;
    }

    case "setProgressBar":
      Object.assign(p.overlays.progressBar, cmd.bar);
      return true;

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
