import { z } from "zod";

// Edit plan v1 (single source, cuts only). Kept only so saved v1 plans can be
// read and migrated; see migrate.ts. New code uses schema.ts (v2).

export const WordSchema = z.object({
  id: z.string(),
  text: z.string(),
  startMs: z.number().nonnegative(),
  endMs: z.number().nonnegative(),
  filler: z.boolean().optional(),
});

export const CutReasonSchema = z.enum(["silence", "filler", "retake", "manual"]);

export const CutSchema = z.object({
  id: z.string(),
  startMs: z.number().nonnegative(),
  endMs: z.number().nonnegative(),
  reason: CutReasonSchema,
  // Shown in the UI, e.g. "Repeated line — kept the second take".
  note: z.string().optional(),
});

export const ZoomStyleSchema = z.enum(["smooth", "punch", "push", "linear"]);

export const ZoomSchema = z.object({
  id: z.string(),
  startMs: z.number().nonnegative(),
  endMs: z.number().nonnegative(),
  scale: z.number().min(1).max(2),
  style: ZoomStyleSchema,
  // Point to zoom into, as fractions of the frame (0–1).
  focusX: z.number().min(0).max(1).default(0.5),
  focusY: z.number().min(0).max(1).default(0.35),
});

export const EditPlanV1Schema = z.object({
  version: z.literal(1),
  id: z.string(),
  title: z.string(),
  vibe: z.enum(["energetic", "clean", "story"]),

  source: z.object({
    src: z.string(),
    poster: z.string().optional(),
    width: z.number(),
    height: z.number(),
    durationMs: z.number().positive(),
  }),

  output: z.object({
    width: z.number().default(1080),
    height: z.number().default(1920),
    fps: z.number().default(30),
  }),

  transcript: z.object({ words: z.array(WordSchema) }),

  cuts: z.object({
    items: z.array(CutSchema),
    // Which automatic cut types are active. Manual cuts are always active.
    silence: z.boolean(),
    filler: z.boolean(),
    retake: z.boolean(),
    // Auto cuts the user clicked to bring back.
    restored: z.array(z.string()),
  }),

  captions: z.object({
    enabled: z.boolean(),
    presetId: z.string(),
    size: z.number().min(40).max(140),
    positionY: z.number().min(0.15).max(0.9),
    wordsPerLine: z.union([z.literal(1), z.literal(2), z.literal(3)]),
    showEmojis: z.boolean(),
    highlights: z.array(z.string()),
    emojis: z.record(z.string(), z.string()),
    edits: z.record(z.string(), z.string()),
  }),

  zooms: z.object({
    enabled: z.boolean(),
    items: z.array(ZoomSchema),
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

export type EditPlanV1 = z.infer<typeof EditPlanV1Schema>;
