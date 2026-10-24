import { z } from "zod";

// Edit plan v2 (clips + overlays.texts/images). Kept only so saved v2 plans can be
// read and migrated; see migrate.ts. New code uses schema.ts (v3).

export const WordSchema = z.object({
  id: z.string(),
  text: z.string(),
  startMs: z.number().nonnegative(),
  endMs: z.number().nonnegative(),
  filler: z.boolean().optional(),
});

export const SourceSchema = z.object({
  id: z.string(),
  src: z.string(),
  poster: z.string().optional(),
  width: z.number().positive(),
  height: z.number().positive(),
  durationMs: z.number().positive(),
  words: z.array(WordSchema),
});

export const ClipSchema = z.object({
  id: z.string(),
  sourceId: z.string(),
  inMs: z.number().nonnegative(),
  outMs: z.number().positive(),
  speed: z.number().min(0.25).max(4),
  volume: z.number().min(0).max(2),
  muted: z.boolean(),
  frame: z.object({
    fit: z.enum(["fill", "fit"]),
    scale: z.number().min(0.2).max(4),
    x: z.number(), // offset as a fraction of canvas width
    y: z.number(), // offset as a fraction of canvas height
    rotate: z.union([z.literal(0), z.literal(90), z.literal(180), z.literal(270)]),
    flipH: z.boolean(),
    flipV: z.boolean(),
  }),
  // Fractions (0–0.9) trimmed from each edge of the source frame.
  crop: z.object({ left: z.number(), top: z.number(), right: z.number(), bottom: z.number() }),
  color: z.object({
    preset: z.enum(["none", "natural", "warm", "cool", "vivid", "mono", "film"]),
    brightness: z.number().min(-1).max(1),
    contrast: z.number().min(-1).max(1),
    saturation: z.number().min(-1).max(1),
    temperature: z.number().min(-1).max(1),
  }),
});

export const CutReasonSchema = z.enum(["silence", "filler", "retake", "manual"]);

export const CutSchema = z.object({
  id: z.string(),
  sourceId: z.string(),
  startMs: z.number().nonnegative(),
  endMs: z.number().nonnegative(),
  reason: CutReasonSchema,
  note: z.string().optional(),
});

export const ZoomStyleSchema = z.enum(["smooth", "punch", "push", "linear"]);

export const ZoomSchema = z.object({
  id: z.string(),
  sourceId: z.string(),
  startMs: z.number().nonnegative(),
  endMs: z.number().nonnegative(),
  scale: z.number().min(1).max(2),
  style: ZoomStyleSchema,
  focusX: z.number().min(0).max(1),
  focusY: z.number().min(0).max(1),
});

export const TextOverlaySchema = z.object({
  id: z.string(),
  startMs: z.number().nonnegative(), // output time
  endMs: z.number().nonnegative(),
  text: z.string(),
  presetId: z.string(),
  x: z.number().min(0).max(1),
  y: z.number().min(0).max(1),
  size: z.number().min(16).max(240),
  animation: z.enum(["none", "fade", "pop", "slide"]),
});

export const ImageOverlaySchema = z.object({
  id: z.string(),
  startMs: z.number().nonnegative(),
  endMs: z.number().nonnegative(),
  src: z.string(),
  x: z.number().min(0).max(1),
  y: z.number().min(0).max(1),
  width: z.number().min(0.02).max(1), // fraction of canvas width
  opacity: z.number().min(0).max(1),
});

export const AspectSchema = z.enum(["9:16", "1:1", "4:5", "16:9", "custom"]);

export const EditPlanV2Schema = z.object({
  version: z.literal(2),
  id: z.string(),
  title: z.string(),
  vibe: z.enum(["energetic", "clean", "story"]),

  canvas: z.object({
    aspect: AspectSchema,
    width: z.number().int().min(240).max(4096),
    height: z.number().int().min(240).max(4096),
    fps: z.number().int().min(12).max(60),
    background: z.object({ type: z.enum(["blur", "color"]), color: z.string() }),
  }),

  sources: z.array(SourceSchema).min(1),
  clips: z.array(ClipSchema).min(1),

  cuts: z.object({
    items: z.array(CutSchema),
    silence: z.boolean(),
    filler: z.boolean(),
    retake: z.boolean(),
    restored: z.array(z.string()),
  }),

  captions: z.object({
    enabled: z.boolean(),
    presetId: z.string(),
    size: z.number().min(40).max(160),
    positionY: z.number().min(0.1).max(0.92),
    wordsPerLine: z.union([z.literal(1), z.literal(2), z.literal(3)]),
    showEmojis: z.boolean(),
    highlights: z.array(z.string()),
    emojis: z.record(z.string(), z.string()),
    edits: z.record(z.string(), z.string()),
  }),

  zooms: z.object({ enabled: z.boolean(), items: z.array(ZoomSchema) }),

  overlays: z.object({
    texts: z.array(TextOverlaySchema),
    images: z.array(ImageOverlaySchema),
    progressBar: z.object({ enabled: z.boolean(), position: z.enum(["top", "bottom"]), color: z.string() }),
  }),

  music: z.object({
    trackId: z.string().nullable(),
    volume: z.number().min(0).max(1),
    ducking: z.boolean(),
    duckTo: z.number().min(0).max(1),
    fadeInMs: z.number().nonnegative(),
    fadeOutMs: z.number().nonnegative(),
  }),

  hook: z.object({
    enabled: z.boolean(),
    text: z.string(),
    options: z.array(z.string()),
    durationMs: z.number().positive(),
  }),

  voice: z.object({ enhance: z.boolean() }),
});

export type EditPlanV2 = z.infer<typeof EditPlanV2Schema>;
export type TextOverlayV2 = z.infer<typeof TextOverlaySchema>;
