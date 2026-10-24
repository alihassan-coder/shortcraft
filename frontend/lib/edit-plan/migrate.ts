import { DEFAULT_CLIP_LOOK, EditPlanSchema, type EditPlan } from "./schema";
import { EditPlanV1Schema, type EditPlanV1 } from "./schema-v1";

// v1 had one source with cuts. v2 puts that source in sources[] and plays it
// as a single clip, so nothing about the edit changes.
export function migrateV1toV2(v1: EditPlanV1): EditPlan {
  const sourceId = "src-1";
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
    clips: [{ id: "clip-1", sourceId, inMs: 0, outMs: v1.source.durationMs, ...structuredClone(DEFAULT_CLIP_LOOK) }],
    cuts: { ...v1.cuts, items: v1.cuts.items.map((c) => ({ ...c, sourceId })) },
    captions: v1.captions,
    zooms: { enabled: v1.zooms.enabled, items: v1.zooms.items.map((z) => ({ ...z, sourceId })) },
    overlays: { texts: [], images: [], progressBar: { enabled: false, position: "bottom", color: "#ffffff" } },
    music: v1.music,
    hook: v1.hook,
    voice: v1.voice,
  };
}

// Accepts any saved or received plan and returns a valid v2 plan, or null.
export function parsePlan(raw: unknown): EditPlan | null {
  const v2 = EditPlanSchema.safeParse(raw);
  if (v2.success) return v2.data;
  const v1 = EditPlanV1Schema.safeParse(raw);
  if (v1.success) return migrateV1toV2(v1.data);
  return null;
}
