import {
  DEFAULT_CLIP_LOOK,
  EditPlanSchema,
  NO_ANIMATION,
  TRACK_NAMES,
  type Animation,
  type AnimationType,
  type EditPlan,
  type ImageItem,
  type TextItem,
  type Track,
} from "./schema";
import { EditPlanV1Schema, type EditPlanV1 } from "./schema-v1";
import { EditPlanV2Schema, type EditPlanV2, type TextOverlayV2 } from "./schema-v2";
import { presetById, presetTextStyle, toHexColor } from "./text-styles";

// v1 had one source with cuts. v2 puts that source in sources[] and plays it
// as a single clip, so nothing about the edit changes.
export function migrateV1toV2(v1: EditPlanV1): EditPlanV2 {
  const sourceId = "src-1";
  const { frame, crop, color, speed, volume, muted } = structuredClone(DEFAULT_CLIP_LOOK);
  const { opacity: _opacity, ...frameV2 } = frame;
  void _opacity;
  return {
    version: 2,
    id: v1.id,
    title: v1.title,
    vibe: v1.vibe,
    canvas: {
      aspect: "9:16",
      width: v1.output.width,
      height: v1.output.height,
      fps: v1.output.fps,
      background: { type: "blur", color: "#000000" },
    },
    sources: [{ id: sourceId, ...v1.source, words: v1.transcript.words }],
    clips: [{ id: "clip-1", sourceId, inMs: 0, outMs: v1.source.durationMs, speed, volume, muted, frame: frameV2, crop, color }],
    cuts: { ...v1.cuts, items: v1.cuts.items.map((c) => ({ ...c, sourceId })) },
    captions: v1.captions,
    zooms: { enabled: v1.zooms.enabled, items: v1.zooms.items.map((z) => ({ ...z, sourceId })) },
    overlays: { texts: [], images: [], progressBar: { enabled: false, position: "bottom", color: "#ffffff" } },
    music: v1.music,
    hook: v1.hook,
    voice: v1.voice,
  };
}

const V2_ANIMATION: Record<TextOverlayV2["animation"], AnimationType> = {
  none: "none",
  fade: "fade",
  pop: "pop",
  slide: "slide-up",
};

// v2 animated text in over 220ms and out over 200ms with the same effect.
function textAnimationFromV2(a: TextOverlayV2["animation"]): Animation {
  const type = V2_ANIMATION[a];
  return type === "none"
    ? { in: { ...NO_ANIMATION }, out: { ...NO_ANIMATION }, loop: "none" }
    : { in: { type, durationMs: 220 }, out: { type, durationMs: 200 }, loop: "none" };
}

// v2 kept texts and images in `overlays`. v3 puts them on tracks (text below
// images, as v2 drew them), turns the text preset into a full style, and moves
// the progress bar to the top level.
export function migrateV2toV3(v2: EditPlanV2): EditPlan {
  const { overlays, ...rest } = v2;
  const tracks: Track[] = [];

  if (overlays.texts.length) {
    tracks.push({
      id: "track-text",
      kind: "text",
      name: TRACK_NAMES.text,
      locked: false,
      hidden: false,
      muted: false,
      items: overlays.texts.map(
        (t): TextItem => ({
          id: t.id,
          kind: "text",
          startMs: t.startMs,
          endMs: t.endMs,
          text: t.text,
          presetId: t.presetId,
          style: presetTextStyle(presetById(t.presetId), t.size),
          transform: { x: t.x, y: t.y, scale: 1, rotation: 0, opacity: 1 },
          animation: textAnimationFromV2(t.animation),
        }),
      ),
    });
  }

  if (overlays.images.length) {
    tracks.push({
      id: "track-image",
      kind: "image",
      name: TRACK_NAMES.image,
      locked: false,
      hidden: false,
      muted: false,
      items: overlays.images.map(
        (i): ImageItem => ({
          id: i.id,
          kind: "image",
          startMs: i.startMs,
          endMs: i.endMs,
          src: i.src,
          width: i.width,
          transform: { x: i.x, y: i.y, scale: 1, rotation: 0, opacity: i.opacity },
          animation: { in: { ...NO_ANIMATION }, out: { ...NO_ANIMATION }, loop: "none" },
        }),
      ),
    });
  }

  return {
    ...rest,
    version: 3,
    canvas: { ...v2.canvas, background: { ...v2.canvas.background, color: toHexColor(v2.canvas.background.color, "#000000") } },
    clips: v2.clips.map((c) => ({
      ...c,
      frame: { ...c.frame, opacity: 1 },
      animation: structuredClone(DEFAULT_CLIP_LOOK.animation),
    })),
    tracks,
    progressBar: { ...overlays.progressBar, color: toHexColor(overlays.progressBar.color), thickness: 14 },
  };
}

// Accepts any saved or received plan (v1, v2 or v3) and returns a valid v3 plan, or null.
export function parsePlan(raw: unknown): EditPlan | null {
  const v3 = EditPlanSchema.safeParse(raw);
  if (v3.success) return v3.data;
  const v2 = EditPlanV2Schema.safeParse(raw);
  const v1 = v2.success ? null : EditPlanV1Schema.safeParse(raw);
  const fromOld = v2.success ? v2.data : v1?.success ? migrateV1toV2(v1.data) : null;
  if (!fromOld) return null;
  // Migration output is re-validated so a bad old value can't slip into the editor.
  const migrated = EditPlanSchema.safeParse(migrateV2toV3(fromOld));
  return migrated.success ? migrated.data : null;
}
