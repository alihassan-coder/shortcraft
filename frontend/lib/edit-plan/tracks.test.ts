import { describe, expect, it } from "vitest";
import { applyEdit, applyEdits, MIN_ITEM_MS, type EditCommand } from "./commands";
import { DEMO_PLAN } from "./demo-plan";
import { migrateV2toV3, parsePlan } from "./migrate";
import { DEFAULT_CLIP_LOOK, EditPlanSchema, type EditPlan, type TextItem } from "./schema";
import type { EditPlanV2 } from "./schema-v2";
import { resolveTimeline } from "./timeline";

// Two clips, no cuts: output time = source time, 10s long.
function plan(): EditPlan {
  return {
    ...structuredClone(DEMO_PLAN),
    sources: [{ id: "s", src: "/x.mp4", width: 720, height: 1280, durationMs: 10000, words: [] }],
    clips: [
      { id: "c1", sourceId: "s", inMs: 0, outMs: 5000, ...structuredClone(DEFAULT_CLIP_LOOK) },
      { id: "c2", sourceId: "s", inMs: 5000, outMs: 10000, ...structuredClone(DEFAULT_CLIP_LOOK) },
    ],
    cuts: { items: [], silence: true, filler: true, retake: true, restored: [] },
    zooms: { enabled: false, items: [] },
    tracks: [],
  };
}

const valid = (p: EditPlan) => {
  const r = EditPlanSchema.safeParse(p);
  if (!r.success) throw new Error(JSON.stringify(r.error.issues, null, 2));
  return true;
};

const item = (p: EditPlan, id: string) => p.tracks.flatMap((t) => t.items).find((i) => i.id === id)!;
const text = (p: EditPlan, id: string) => item(p, id) as TextItem;

// The demo plan written the v2 way (what an older editor saved).
function v2Plan(): EditPlanV2 {
  const p: Record<string, unknown> = structuredClone(DEMO_PLAN);
  delete p.tracks;
  delete p.progressBar;
  const clips = DEMO_PLAN.clips.map((c) => {
    const frame: Record<string, unknown> = { ...c.frame };
    const clip: Record<string, unknown> = { ...c, frame };
    delete frame.opacity;
    delete clip.animation;
    return clip;
  });
  return {
    ...(p as Omit<EditPlanV2, "version" | "clips" | "overlays">),
    version: 2,
    canvas: { ...DEMO_PLAN.canvas, background: { type: "color", color: "#123456" } },
    clips: clips as EditPlanV2["clips"],
    overlays: {
      texts: [
        { id: "t1", startMs: 100, endMs: 2000, text: "Hello", presetId: "bold-pop", x: 0.4, y: 0.2, size: 90, animation: "slide" },
        { id: "t2", startMs: 500, endMs: 900, text: "Box", presetId: "boxed", x: 0.5, y: 0.5, size: 60, animation: "none" },
      ],
      images: [{ id: "i1", startMs: 0, endMs: 3000, src: "/logo.png", x: 0.9, y: 0.1, width: 0.2, opacity: 0.7 }],
      progressBar: { enabled: true, position: "top", color: "#FF5B1F" },
    },
  };
}

describe("migration v2 → v3", () => {
  it("moves texts and images onto tracks and the progress bar to the top level", () => {
    const v3 = migrateV2toV3(v2Plan());
    expect(valid(v3)).toBe(true);
    expect(v3.version).toBe(3);
    expect(v3.tracks.map((t) => [t.kind, t.name, t.items.length])).toEqual([
      ["text", "Text", 2],
      ["image", "Images", 1],
    ]);
    expect(v3.progressBar).toEqual({ enabled: true, position: "top", color: "#ff5b1f", thickness: 14 });
    expect(v3.canvas.background.color).toBe("#123456");
  });

  it("turns text presets into full styles and keeps position, size and animation", () => {
    const v3 = migrateV2toV3(v2Plan());
    const t1 = text(v3, "t1");
    expect(t1).toMatchObject({ text: "Hello", presetId: "bold-pop", startMs: 100, endMs: 2000, transform: { x: 0.4, y: 0.2, scale: 1 } });
    expect(t1.style).toMatchObject({ size: 90, case: "upper", fontWeight: 900, stroke: { color: "#000000" } });
    expect(t1.animation.in).toEqual({ type: "slide-up", durationMs: 220 });
    expect(text(v3, "t2").style.background).toMatchObject({ color: "#000000", opacity: 0.65 });
    expect(text(v3, "t2").animation.in.type).toBe("none");
    expect(item(v3, "i1")).toMatchObject({ kind: "image", src: "/logo.png", width: 0.2, transform: { x: 0.9, opacity: 0.7 } });
  });

  it("parsePlan accepts v2 JSON (as saved in localStorage) and returns v3", () => {
    const parsed = parsePlan(JSON.parse(JSON.stringify(v2Plan())));
    expect(parsed?.version).toBe(3);
    expect(parsed?.tracks[0].items).toHaveLength(2);
    expect(parsed?.clips[0].frame.opacity).toBe(1);
  });
});

describe("applyEdit — items", () => {
  it("creates a track on the first addItem and reuses it after", () => {
    let p = applyEdit(plan(), { type: "addItem", trackKind: "text", atMs: 1000, item: { id: "a", text: "A" } });
    expect(p.tracks).toHaveLength(1);
    expect(p.tracks[0]).toMatchObject({ kind: "text", name: "Text", locked: false });
    expect(item(p, "a")).toMatchObject({ startMs: 1000, endMs: 3500 });
    p = applyEdit(p, { type: "addItem", trackKind: "text", item: { id: "b" } });
    expect(p.tracks).toHaveLength(1);
    p = applyEdit(p, { type: "addItem", trackKind: "element", item: { id: "e" } });
    expect(p.tracks.map((t) => t.kind)).toEqual(["text", "element"]);
    expect(valid(p)).toBe(true);
  });

  it("never starts a new item at the very end", () => {
    const p = applyEdit(plan(), { type: "addItem", trackKind: "text", atMs: 99999, item: { id: "a" } });
    expect(item(p, "a")).toMatchObject({ startMs: 9500, endMs: 10000 });
  });

  it("rejects invalid patches with the same plan", () => {
    const p = applyEdit(plan(), { type: "addItem", trackKind: "text", item: { id: "a" } });
    expect(applyEdit(p, { type: "updateItem", itemId: "a", patch: { style: { color: "red" } } })).toBe(p);
    expect(applyEdit(p, { type: "updateItem", itemId: "nope", patch: { text: "x" } })).toBe(p);
  });

  it("deep-merges style, transform and animation patches", () => {
    let p = applyEdit(plan(), { type: "addItem", trackKind: "text", item: { id: "a" } });
    const before = text(p, "a");
    p = applyEdits(p, [
      { type: "updateItem", itemId: "a", patch: { style: { color: "#ff0000", stroke: { width: 4 } } } },
      { type: "updateItem", itemId: "a", patch: { style: { stroke: { color: "#00ff00" } }, transform: { x: 0.2 } } },
      { type: "updateItem", itemId: "a", patch: { animation: { out: { type: "fade" } } } },
    ]);
    const t = text(p, "a");
    expect(t.style).toMatchObject({ color: "#ff0000", fontFamily: before.style.fontFamily, size: before.style.size, stroke: { color: "#00ff00", width: 4 } });
    expect(t.transform).toMatchObject({ x: 0.2, y: before.transform.y, opacity: 1 });
    expect(t.animation.out).toEqual({ type: "fade", durationMs: before.animation.out.durationMs });
    expect(t.animation.in).toEqual(before.animation.in);
    p = applyEdit(p, { type: "updateItem", itemId: "a", patch: { style: { stroke: null, shadow: {} } } });
    expect(text(p, "a").style.stroke).toBeUndefined();
    expect(text(p, "a").style.shadow).toEqual({ color: "#00000099", blur: 8, x: 0, y: 2 });
    expect(valid(p)).toBe(true);
  });

  it("clamps transforms into the canvas", () => {
    let p = applyEdit(plan(), { type: "addItem", trackKind: "element", item: { id: "e" } });
    p = applyEdit(p, { type: "updateItem", itemId: "e", patch: { transform: { x: 1.4, opacity: -1 } } });
    expect(item(p, "e")).toMatchObject({ transform: { x: 1, opacity: 0 } });
  });

  it("moves an item keeping its length and clamping to the output duration", () => {
    let p = applyEdit(plan(), { type: "addItem", trackKind: "text", item: { id: "a", startMs: 0, endMs: 2000 } });
    p = applyEdit(p, { type: "moveItem", itemId: "a", startMs: 9000 });
    expect(item(p, "a")).toMatchObject({ startMs: 8000, endMs: 10000 });
    p = applyEdit(p, { type: "moveItem", itemId: "a", startMs: -500 });
    expect(item(p, "a")).toMatchObject({ startMs: 0, endMs: 2000 });
  });

  it("moves an item to another track of the same kind only", () => {
    let p = applyEdits(plan(), [
      { type: "addItem", trackKind: "text", item: { id: "a" } },
      { type: "addTrack", kind: "text", trackId: "t2" },
      { type: "addTrack", kind: "sfx", trackId: "fx" },
    ]);
    expect(applyEdit(p, { type: "moveItem", itemId: "a", toTrackId: "fx" })).toBe(p);
    p = applyEdit(p, { type: "moveItem", itemId: "a", toTrackId: "t2" });
    expect(p.tracks.find((t) => t.id === "t2")!.items.map((i) => i.id)).toEqual(["a"]);
    expect(valid(p)).toBe(true);
  });

  it("trims an edge but never below the minimum length", () => {
    let p = applyEdit(plan(), { type: "addItem", trackKind: "text", item: { id: "a", startMs: 1000, endMs: 3000 } });
    p = applyEdit(p, { type: "trimItem", itemId: "a", edge: "start", ms: 2950 });
    expect(item(p, "a")).toMatchObject({ startMs: 3000 - MIN_ITEM_MS, endMs: 3000 });
    p = applyEdit(p, { type: "trimItem", itemId: "a", edge: "end", ms: 0 });
    expect(item(p, "a").endMs - item(p, "a").startMs).toBe(MIN_ITEM_MS);
    p = applyEdit(p, { type: "trimItem", itemId: "a", edge: "end", ms: 60000 });
    expect(item(p, "a").endMs).toBe(10000);
  });

  it("duplicates with the same style, nudged down", () => {
    let p = applyEdits(plan(), [
      { type: "addItem", trackKind: "text", item: { id: "a", style: { color: "#ff00ff", italic: true } } },
      { type: "duplicateItems", itemIds: ["a"], newIds: ["b"] },
    ]);
    expect(text(p, "b").style).toEqual(text(p, "a").style);
    expect(text(p, "b").transform.y).toBeCloseTo(text(p, "a").transform.y + 0.06);
    expect(text(p, "b").startMs).toBe(text(p, "a").startMs);
    p = applyEdits(p, [
      { type: "addItem", trackKind: "sfx", item: { id: "fx", startMs: 1000, endMs: 1500 } },
      { type: "duplicateItems", itemIds: ["fx"], newIds: ["fx2"] },
    ]);
    expect(item(p, "fx2")).toMatchObject({ startMs: 1500, endMs: 2000 });
  });

  it("locked tracks reject item edits", () => {
    const base = applyEdit(plan(), { type: "addItem", trackKind: "text", item: { id: "a" } });
    const trackId = base.tracks[0].id;
    const p = applyEdit(base, { type: "updateTrack", trackId, patch: { locked: true } });
    const edits: EditCommand[] = [
      { type: "updateItem", itemId: "a", patch: { text: "x" } },
      { type: "removeItems", itemIds: ["a"] },
      { type: "moveItem", itemId: "a", startMs: 3000 },
      { type: "trimItem", itemId: "a", edge: "end", ms: 4000 },
      { type: "duplicateItems", itemIds: ["a"] },
      { type: "addItem", trackKind: "text", trackId },
      { type: "removeTrack", trackId },
    ];
    for (const cmd of edits) expect(applyEdit(p, cmd)).toBe(p);
    // Adding without a track id goes to a new, unlocked track instead.
    expect(applyEdit(p, { type: "addItem", trackKind: "text" }).tracks).toHaveLength(2);
    // Unlocking works.
    expect(applyEdit(p, { type: "updateTrack", trackId, patch: { locked: false } }).tracks[0].locked).toBe(false);
  });

  it("reorders tracks and removes them", () => {
    let p = applyEdits(plan(), [
      { type: "addTrack", kind: "text", trackId: "a" },
      { type: "addTrack", kind: "element", trackId: "b" },
      { type: "addTrack", kind: "image", trackId: "c" },
      { type: "reorderTrack", trackId: "c", toIndex: 0 },
    ]);
    expect(p.tracks.map((t) => t.id)).toEqual(["c", "a", "b"]);
    p = applyEdit(p, { type: "reorderTrack", trackId: "a", toIndex: 99 });
    expect(p.tracks.map((t) => t.id)).toEqual(["c", "b", "a"]);
    p = applyEdit(p, { type: "removeTrack", trackId: "b" });
    expect(p.tracks.map((t) => t.id)).toEqual(["c", "a"]);
  });

  it("keeps every result schema-valid", () => {
    const p = applyEdits(plan(), [
      { type: "addItem", trackKind: "text" },
      { type: "addItem", trackKind: "element", item: { element: { type: "shape", shape: "arrow", fill: "#ffffff", stroke: "#000000", strokeWidth: 4, width: 0.3, height: 0.1 } } },
      { type: "addItem", trackKind: "image", item: { src: "/a.png" } },
      { type: "addItem", trackKind: "sfx", item: { sfxId: "pop" } },
      { type: "setTransition", clipId: "c1", transition: { type: "whip" } },
      { type: "updateClip", clipId: "c2", patch: { frame: { opacity: 0.5 }, animation: { in: { type: "fade", durationMs: 300 } } } },
      { type: "setProgressBar", bar: { enabled: true, thickness: 20 } },
      { type: "splitAt", outMs: 7000 },
    ]);
    expect(valid(p)).toBe(true);
  });
});

describe("resolveTimeline — items", () => {
  const layered = () =>
    applyEdits(plan(), [
      { type: "addTrack", kind: "image", trackId: "img" },
      { type: "addTrack", kind: "text", trackId: "txt" },
      { type: "addItem", trackKind: "text", trackId: "txt", item: { id: "t", startMs: 1000, endMs: 3000 } },
      { type: "addItem", trackKind: "image", trackId: "img", item: { id: "i", src: "/a.png", startMs: 0, endMs: 5000 } },
      { type: "addItem", trackKind: "sfx", item: { id: "fx", startMs: 2000, endMs: 2500 } },
    ]);

  it("itemsAt returns visible items bottom layer first", () => {
    const p = layered();
    const tl = resolveTimeline(p);
    expect(tl.itemsAt(2000).map((x) => x.item.id)).toEqual(["i", "t"]);
    expect(tl.itemsAt(500).map((x) => x.item.id)).toEqual(["i"]);
    expect(tl.itemsAt(3000).map((x) => x.item.id)).toEqual(["i"]); // end is exclusive
    const flipped = applyEdit(p, { type: "reorderTrack", trackId: "txt", toIndex: 0 });
    expect(resolveTimeline(flipped).itemsAt(2000).map((x) => x.item.id)).toEqual(["t", "i"]);
  });

  it("excludes hidden tracks, sfx and original mode", () => {
    const p = applyEdit(layered(), { type: "updateTrack", trackId: "img", patch: { hidden: true } });
    expect(resolveTimeline(p).itemsAt(2000).map((x) => x.item.id)).toEqual(["t"]);
    expect(resolveTimeline(p, { original: true }).itemsAt(2000)).toEqual([]);
  });

  it("lists sfx cues unless the track is muted", () => {
    const p = layered();
    expect(resolveTimeline(p).sfxCues).toMatchObject([{ itemId: "fx", sfxId: "whoosh", startMs: 2000, endMs: 2500 }]);
    const fxTrack = p.tracks.find((t) => t.kind === "sfx")!.id;
    expect(resolveTimeline(applyEdit(p, { type: "updateTrack", trackId: fxTrack, patch: { muted: true } })).sfxCues).toEqual([]);
  });
});

describe("transitions", () => {
  it("sets, updates and removes a transition into the next clip", () => {
    let p = applyEdit(plan(), { type: "setTransition", clipId: "c1", transition: { type: "slide" } });
    expect(p.clips[0].transition).toEqual({ type: "slide", durationMs: 400 });
    p = applyEdit(p, { type: "setTransition", clipId: "c1", transition: { durationMs: 9000 } });
    expect(p.clips[0].transition).toEqual({ type: "slide", durationMs: 2000 });
    expect(resolveTimeline(p).transitions).toEqual([{ fromClipId: "c1", toClipId: "c2", atMs: 5000, type: "slide", durationMs: 2000 }]);
    p = applyEdit(p, { type: "setTransition", clipId: "c1", transition: null });
    expect(p.clips[0].transition).toBeUndefined();
    expect(resolveTimeline(p).transitions).toEqual([]);
  });

  it("the last clip can't have one", () => {
    const base = plan();
    expect(applyEdit(base, { type: "setTransition", clipId: "c2", transition: { type: "fade" } })).toBe(base);
  });
});
