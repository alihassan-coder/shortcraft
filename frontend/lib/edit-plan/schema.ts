import { z } from "zod";

// Edit plan v3: the single source of truth for a video edit.
// The AI agents write it, the editor changes it (via applyEdit), Remotion renders it.
//
// Two clocks:
//   source time = milliseconds inside an uploaded video (cuts, zooms, words)
//   output time = milliseconds in the finished short (track items, hook)
// resolveTimeline() converts between them; nothing else should.
//
// v3 replaces v2's `overlays` with ordered `tracks` of items (text, element,
// image, sfx). Track order is layer order: tracks[0] is drawn first (bottom).

/* ---------- shared ---------- */

/** "#RRGGBB" or "#RRGGBBAA". */
export const ColorSchema = z.string().regex(/^#(?:[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/, "Expected #RRGGBB or #RRGGBBAA");

export const AnimationTypeSchema = z.enum([
  "none",
  "fade",
  "pop",
  "slide-up",
  "slide-down",
  "slide-left",
  "slide-right",
  "typewriter",
  "bounce",
]);

export const AnimationPhaseSchema = z.object({
  type: AnimationTypeSchema,
  durationMs: z.number().min(0).max(5000),
});

export const LoopAnimationSchema = z.enum(["none", "pulse", "wiggle"]);

export const AnimationSchema = z.object({
  in: AnimationPhaseSchema,
  out: AnimationPhaseSchema,
  loop: LoopAnimationSchema,
});

/** Where an item sits on the canvas. x/y are its center as a fraction of the canvas. */
export const TransformSchema = z.object({
  x: z.number().min(0).max(1),
  y: z.number().min(0).max(1),
  scale: z.number().min(0.05).max(10),
  rotation: z.number().min(-360).max(360), // degrees
  opacity: z.number().min(0).max(1),
});

/* ---------- sources & clips ---------- */

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

export const TransitionTypeSchema = z.enum(["none", "fade", "slide", "wipe", "zoom", "whip"]);

/** Transition from this clip INTO the next one, centred on the cut. */
export const TransitionSchema = z.object({
  type: TransitionTypeSchema,
  durationMs: z.number().min(0).max(2000),
});

export const ClipSchema = z.object({
  id: z.string(),
  sourceId: z.string(),
  inMs: z.number().nonnegative(),
  outMs: z.number().positive(),
  speed: z.number().min(0.25).max(4),
  volume: z.number().min(0).max(2),
  muted: z.boolean(),
  /** The clip's transform on the canvas. */
  frame: z.object({
    fit: z.enum(["fill", "fit"]),
    scale: z.number().min(0.2).max(4),
    x: z.number(), // offset as a fraction of canvas width
    y: z.number(), // offset as a fraction of canvas height
    rotate: z.union([z.literal(0), z.literal(90), z.literal(180), z.literal(270)]),
    flipH: z.boolean(),
    flipV: z.boolean(),
    opacity: z.number().min(0).max(1),
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
  animation: AnimationSchema.pick({ in: true, out: true }),
  transition: TransitionSchema.optional(),
  /** The clip's audio was split onto its own track (E7); the video plays silent. */
  audioDetached: z.boolean().optional(),
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

/* ---------- track items (output time) ---------- */

export const TextStyleSchema = z.object({
  fontFamily: z.string(),
  fontWeight: z.number().int().min(100).max(900),
  italic: z.boolean(),
  size: z.number().min(8).max(400), // px at canvas resolution
  letterSpacing: z.number().min(-0.5).max(2), // em
  lineHeight: z.number().min(0.5).max(3),
  align: z.enum(["left", "center", "right"]),
  case: z.enum(["none", "upper", "lower", "title"]),
  color: ColorSchema,
  gradient: z.object({ from: ColorSchema, to: ColorSchema, angle: z.number() }).optional(),
  stroke: z.object({ color: ColorSchema, width: z.number().min(0).max(60) }).optional(),
  shadow: z.object({ color: ColorSchema, blur: z.number().min(0).max(200), x: z.number(), y: z.number() }).optional(),
  background: z
    .object({
      color: ColorSchema,
      opacity: z.number().min(0).max(1),
      padding: z.number().min(0).max(400),
      radius: z.number().min(0).max(400),
    })
    .optional(),
});

export const ElementSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("emoji"), emoji: z.string().min(1) }),
  z.object({
    type: z.literal("shape"),
    shape: z.enum(["rect", "circle", "line", "arrow"]),
    fill: ColorSchema,
    stroke: ColorSchema,
    strokeWidth: z.number().min(0).max(100),
    // Both as a fraction of canvas WIDTH, so a square stays square on any aspect.
    width: z.number().min(0.01).max(2),
    height: z.number().min(0.005).max(4),
  }),
  z.object({ type: z.literal("sticker"), stickerId: z.string() }),
]);

const itemBase = {
  id: z.string(),
  startMs: z.number().nonnegative(), // output time
  endMs: z.number().nonnegative(),
};

const visualBase = { ...itemBase, transform: TransformSchema, animation: AnimationSchema };

export const TextItemSchema = z.object({
  ...visualBase,
  kind: z.literal("text"),
  text: z.string(),
  style: TextStyleSchema,
  presetId: z.string().optional(),
});

export const ElementItemSchema = z.object({ ...visualBase, kind: z.literal("element"), element: ElementSchema });

export const ImageItemSchema = z.object({
  ...visualBase,
  kind: z.literal("image"),
  src: z.string(),
  width: z.number().min(0.02).max(1), // fraction of canvas width
});

export const SfxItemSchema = z.object({
  ...itemBase,
  kind: z.literal("sfx"),
  sfxId: z.string(),
  volume: z.number().min(0).max(2),
  fadeInMs: z.number().nonnegative(),
  fadeOutMs: z.number().nonnegative(),
});

export const ItemSchema = z.discriminatedUnion("kind", [TextItemSchema, ElementItemSchema, ImageItemSchema, SfxItemSchema]);

export const TrackKindSchema = z.enum(["text", "element", "image", "sfx"]);

export const TrackSchema = z
  .object({
    id: z.string(),
    kind: TrackKindSchema,
    name: z.string(),
    locked: z.boolean(),
    hidden: z.boolean(),
    muted: z.boolean(),
    items: z.array(ItemSchema),
  })
  .refine((t) => t.items.every((i) => i.kind === t.kind), { message: "Every item must match its track's kind" });

/* ---------- plan ---------- */

export const AspectSchema = z.enum(["9:16", "1:1", "4:5", "16:9", "custom"]);

export const ProgressBarSchema = z.object({
  enabled: z.boolean(),
  position: z.enum(["top", "bottom"]),
  color: ColorSchema,
  thickness: z.number().min(2).max(60), // px at canvas resolution
});

export const EditPlanSchema = z.object({
  version: z.literal(3),
  id: z.string(),
  title: z.string(),
  vibe: z.enum(["energetic", "clean", "story"]),

  canvas: z.object({
    aspect: AspectSchema,
    width: z.number().int().min(240).max(4096),
    height: z.number().int().min(240).max(4096),
    fps: z.number().int().min(12).max(60),
    background: z.object({ type: z.enum(["blur", "color"]), color: ColorSchema }),
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

  tracks: z.array(TrackSchema),
  progressBar: ProgressBarSchema,

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

export type Color = z.infer<typeof ColorSchema>;
export type AnimationType = z.infer<typeof AnimationTypeSchema>;
export type AnimationPhase = z.infer<typeof AnimationPhaseSchema>;
export type LoopAnimation = z.infer<typeof LoopAnimationSchema>;
export type Animation = z.infer<typeof AnimationSchema>;
export type Transform = z.infer<typeof TransformSchema>;
export type Word = z.infer<typeof WordSchema>;
export type Source = z.infer<typeof SourceSchema>;
export type Clip = z.infer<typeof ClipSchema>;
export type ClipAnimation = Clip["animation"];
export type Transition = z.infer<typeof TransitionSchema>;
export type TransitionType = z.infer<typeof TransitionTypeSchema>;
export type Cut = z.infer<typeof CutSchema>;
export type CutReason = z.infer<typeof CutReasonSchema>;
export type Zoom = z.infer<typeof ZoomSchema>;
export type ZoomStyle = z.infer<typeof ZoomStyleSchema>;
export type TextStyle = z.infer<typeof TextStyleSchema>;
export type Element = z.infer<typeof ElementSchema>;
export type TextItem = z.infer<typeof TextItemSchema>;
export type ElementItem = z.infer<typeof ElementItemSchema>;
export type ImageItem = z.infer<typeof ImageItemSchema>;
export type SfxItem = z.infer<typeof SfxItemSchema>;
export type Item = z.infer<typeof ItemSchema>;
/** Items drawn on the canvas (everything except sound effects). */
export type VisualItem = TextItem | ElementItem | ImageItem;
export type TrackKind = z.infer<typeof TrackKindSchema>;
export type Track = z.infer<typeof TrackSchema>;
export type ProgressBar = z.infer<typeof ProgressBarSchema>;
export type Aspect = z.infer<typeof AspectSchema>;
export type Canvas = EditPlan["canvas"];
export type EditPlan = z.infer<typeof EditPlanSchema>;

export const ASPECT_SIZES: Record<Exclude<Aspect, "custom">, { width: number; height: number }> = {
  "9:16": { width: 1080, height: 1920 },
  "1:1": { width: 1080, height: 1080 },
  "4:5": { width: 1080, height: 1350 },
  "16:9": { width: 1920, height: 1080 },
};

export const NO_ANIMATION: AnimationPhase = { type: "none", durationMs: 0 };

export const DEFAULT_CLIP_LOOK: Pick<Clip, "speed" | "volume" | "muted" | "frame" | "crop" | "color" | "animation"> = {
  speed: 1,
  volume: 1,
  muted: false,
  frame: { fit: "fill", scale: 1, x: 0, y: 0, rotate: 0, flipH: false, flipV: false, opacity: 1 },
  crop: { left: 0, top: 0, right: 0, bottom: 0 },
  color: { preset: "none", brightness: 0, contrast: 0, saturation: 0, temperature: 0 },
  animation: { in: { ...NO_ANIMATION }, out: { ...NO_ANIMATION } },
};

export const DEFAULT_TRANSFORM: Transform = { x: 0.5, y: 0.5, scale: 1, rotation: 0, opacity: 1 };

export const DEFAULT_TEXT_STYLE: TextStyle = {
  fontFamily: "var(--font-geist-sans), system-ui, sans-serif",
  fontWeight: 700,
  italic: false,
  size: 72,
  letterSpacing: 0,
  lineHeight: 1.1,
  align: "center",
  case: "none",
  color: "#ffffff",
};

/** Defaults used when a patch turns on an optional text effect without giving every field. */
export const TEXT_EFFECT_DEFAULTS = {
  gradient: { from: "#ffffff", to: "#e9d5ff", angle: 90 },
  stroke: { color: "#000000", width: 8 },
  shadow: { color: "#00000099", blur: 8, x: 0, y: 2 },
  background: { color: "#000000", opacity: 0.65, padding: 16, radius: 16 },
} satisfies Required<Pick<TextStyle, "gradient" | "stroke" | "shadow" | "background">>;

export const TRACK_NAMES: Record<TrackKind, string> = { text: "Text", element: "Elements", image: "Images", sfx: "Sound effects" };
