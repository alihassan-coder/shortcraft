import { describe, expect, it } from "vitest";
import { applyEdit, applyEdits } from "./commands";
import { DEMO_PLAN } from "./demo-plan";
import { migrateV1toV2, parsePlan } from "./migrate";
import { DEFAULT_CLIP_LOOK, EditPlanSchema, type EditPlan } from "./schema";
import { EditPlanV2Schema } from "./schema-v2";
import { resolveTimeline } from "./timeline";

// A tiny plan with round numbers so expectations are easy to read.
function plan(overrides: Partial<EditPlan> = {}): EditPlan {
  const words = [
    { id: "a", text: "Hello", startMs: 0, endMs: 1000 },
    { id: "b", text: "um", startMs: 1000, endMs: 2000, filler: true },
    { id: "c", text: "world.", startMs: 2000, endMs: 3000 },
    { id: "d", text: "Bye.", startMs: 5000, endMs: 6000 },
  ];
  return {
    ...structuredClone(DEMO_PLAN),
    sources: [{ id: "s", src: "/x.mp4", width: 720, height: 1280, durationMs: 10000, words }],
    clips: [{ id: "c1", sourceId: "s", inMs: 0, outMs: 10000, ...structuredClone(DEFAULT_CLIP_LOOK) }],
    cuts: {
      items: [
        { id: "f", sourceId: "s", startMs: 1000, endMs: 2000, reason: "filler" },
        { id: "p", sourceId: "s", startMs: 3000, endMs: 5000, reason: "silence" },
      ],
      silence: true,
      filler: true,
      retake: true,
      restored: [],
    },
    zooms: { enabled: true, items: [{ id: "z", sourceId: "s", startMs: 5000, endMs: 6000, scale: 1.5, style: "punch", focusX: 0.5, focusY: 0.5 }] },
    captions: { ...DEMO_PLAN.captions, highlights: [], emojis: {}, edits: {}, wordsPerLine: 2 },
    ...overrides,
  };
}

describe("resolveTimeline", () => {
  it("removes active cuts from the output", () => {
    const tl = resolveTimeline(plan());
    expect(tl.durationMs).toBe(7000); // 10s - 1s filler - 2s pause
    expect(tl.words.map((w) => w.id)).toEqual(["a", "c", "d"]);
    expect(tl.words.find((w) => w.id === "d")!.outStart).toBe(2000); // after "Hello" + "world."
  });

  it("brings back restored and disabled cuts", () => {
    expect(resolveTimeline(applyEdit(plan(), { type: "toggleRestoreCut", cutId: "f" })).durationMs).toBe(8000);
    expect(resolveTimeline(applyEdit(plan(), { type: "setCutRules", rules: { silence: false } })).durationMs).toBe(9000);
  });

  it("converts between source and output time", () => {
    const tl = resolveTimeline(plan());
    expect(tl.toOutput("s", 2500)).toBe(1500);
    expect(tl.toOutput("s", 4000)).toBeNull(); // inside the pause cut
    expect(tl.toOutputNearest("s", 4000)).toBe(2000);
    expect(tl.toSource(2000)).toMatchObject({ sourceId: "s", srcMs: 5000 });
  });

  it("applies clip speed to duration and word timing", () => {
    const fast = applyEdit(plan(), { type: "updateClip", clipId: "c1", patch: { speed: 2 } });
    const tl = resolveTimeline(fast);
    expect(tl.durationMs).toBe(3500);
    expect(tl.words.find((w) => w.id === "d")!.outStart).toBe(1000); // pieces: 0.5s + 0.5s before it
  });

  it("finds zooms through cuts", () => {
    const tl = resolveTimeline(plan());
    expect(tl.zoomAt(2500)?.scale).toBeCloseTo(1.5); // output 2.5s = source 5.5s, middle of the zoom
    expect(tl.zoomAt(500)).toBeNull();
  });

  it("returns the full source in original mode", () => {
    expect(resolveTimeline(plan(), { original: true }).durationMs).toBe(10000);
  });

  it("caches by plan identity", () => {
    const p = plan();
    expect(resolveTimeline(p)).toBe(resolveTimeline(p));
  });
});

describe("applyEdit — clips", () => {
  it("splits a clip at an output time", () => {
    const p = applyEdit(plan(), { type: "splitAt", outMs: 2000 }); // source 5s
    expect(p.clips.map((c) => [c.inMs, c.outMs])).toEqual([[0, 5000], [5000, 10000]]);
    expect(resolveTimeline(p).durationMs).toBe(7000); // splitting changes nothing on screen
  });

  it("ignores a split too close to a clip edge", () => {
    const base = plan();
    expect(applyEdit(base, { type: "splitAt", outMs: 10 })).toBe(base);
  });

  it("trims, deletes, moves and duplicates", () => {
    let p = applyEdit(plan(), { type: "splitAt", outMs: 2000 });
    const [left, right] = p.clips;
    p = applyEdit(p, { type: "trimClip", clipId: right.id, edge: "out", srcMs: 8000 });
    expect(p.clips[1].outMs).toBe(8000);
    p = applyEdit(p, { type: "moveClip", clipId: right.id, toIndex: 0 });
    expect(p.clips[0].id).toBe(right.id);
    p = applyEdit(p, { type: "duplicateClip", clipId: left.id });
    expect(p.clips).toHaveLength(3);
    p = applyEdit(p, { type: "deleteClips", clipIds: [left.id] });
    expect(p.clips).toHaveLength(2);
  });

  it("never deletes the last clip", () => {
    const base = plan();
    expect(applyEdit(base, { type: "deleteClips", clipIds: ["c1"] })).toBe(base);
  });
});

describe("applyEdit — transcript, canvas, overlays", () => {
  it("toggles a word cut and restores it", () => {
    let p = applyEdit(plan(), { type: "toggleWordCut", sourceId: "s", wordId: "c" });
    expect(resolveTimeline(p).words.map((w) => w.id)).toEqual(["a", "d"]);
    p = applyEdit(p, { type: "toggleWordCut", sourceId: "s", wordId: "c" });
    expect(resolveTimeline(p).words.map((w) => w.id)).toEqual(["a", "c", "d"]);
  });

  it("restores an auto-cut word by marking its cut restored", () => {
    const p = applyEdit(plan(), { type: "toggleWordCut", sourceId: "s", wordId: "b" });
    expect(p.cuts.restored).toContain("f");
  });

  it("sizes the canvas from aspect and detects custom sizes", () => {
    let p = applyEdit(plan(), { type: "setCanvas", canvas: { aspect: "1:1" } });
    expect([p.canvas.width, p.canvas.height]).toEqual([1080, 1080]);
    p = applyEdit(p, { type: "setCanvas", canvas: { width: 1000, height: 700 } });
    expect(p.canvas.aspect).toBe("custom");
    p = applyEdit(p, { type: "setCanvas", canvas: { width: 1920, height: 1080 } });
    expect(p.canvas.aspect).toBe("16:9");
  });

  it("adds and edits text items", () => {
    let p = applyEdit(plan(), { type: "addItem", trackKind: "text", item: { text: "Hi" } });
    const id = p.tracks[0].items[0].id;
    p = applyEdits(p, [
      { type: "updateItem", itemId: id, patch: { transform: { y: 0.8 } } },
      { type: "setWordText", wordId: "a", text: "Hey" },
    ]);
    expect(p.tracks[0].items[0]).toMatchObject({ text: "Hi", transform: { y: 0.8 } });
    expect(resolveTimeline(p).words[0].display).toBe("Hey");
  });

  it("keeps every result schema-valid", () => {
    const p = applyEdits(plan(), [
      { type: "splitAt", outMs: 2000 },
      { type: "addZoom", sourceId: "s", atMs: 100 },
      { type: "addItem", trackKind: "text" },
      { type: "setCanvas", canvas: { aspect: "4:5" } },
    ]);
    expect(EditPlanSchema.safeParse(p).success).toBe(true);
  });
});

describe("migration", () => {
  it("parses the demo plan and rejects garbage", () => {
    expect(parsePlan(DEMO_PLAN)?.version).toBe(3);
    expect(parsePlan({ nope: true })).toBeNull();
  });

  it("migrates a v1 plan to one full-length clip", () => {
    const v2 = migrateV1toV2({
      version: 1,
      id: "x",
      title: "t",
      vibe: "clean",
      source: { src: "/a.mp4", width: 720, height: 1280, durationMs: 5000 },
      output: { width: 1080, height: 1920, fps: 30 },
      transcript: { words: [] },
      cuts: { items: [], silence: true, filler: true, retake: true, restored: [] },
      captions: DEMO_PLAN.captions,
      zooms: { enabled: true, items: [] },
      music: DEMO_PLAN.music,
      hook: DEMO_PLAN.hook,
      voice: DEMO_PLAN.voice,
    });
    expect(v2.clips).toHaveLength(1);
    expect(v2.clips[0]).toMatchObject({ inMs: 0, outMs: 5000 });
    expect(EditPlanV2Schema.safeParse(v2).success).toBe(true);
    expect(parsePlan(v2)?.version).toBe(3);
  });
});
