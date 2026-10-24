import { describe, expect, it } from "vitest";
import { applyEdit } from "@/lib/edit-plan/commands";
import { DEMO_PLAN } from "@/lib/edit-plan/demo-plan";
import type { EditPlan } from "@/lib/edit-plan/schema";
import { resolveTimeline } from "@/lib/edit-plan/timeline";
import {
  MAX_PPS,
  MIN_PPS,
  clampPps,
  clipOutputLength,
  fitPps,
  formatTimecode,
  insertMarkerMs,
  marqueeHits,
  msToPx,
  ppsToSlider,
  pxToMs,
  reorderIndex,
  rippleMoves,
  rulerSteps,
  rulerTicks,
  scrollForZoom,
  sliderToPps,
  snapRange,
  snapTargets,
  snapValue,
  stepPps,
  trimClipSrcMs,
  visibleRange,
} from "./timeline-view";

/** A plan with no cuts, so output time = source time / speed. */
function plainPlan(speed = 1): EditPlan {
  const p = structuredClone(DEMO_PLAN);
  p.cuts.items = [];
  p.clips[0].speed = speed;
  return p;
}

describe("px ↔ ms", () => {
  it.each([10, 100, 250, 1200])("round-trips at %d px/s", (pps) => {
    expect(msToPx(1000, pps)).toBe(pps);
    expect(pxToMs(msToPx(1234, pps), pps)).toBeCloseTo(1234, 6);
  });

  it("clamps zoom and steps by a constant factor", () => {
    expect(clampPps(1)).toBe(MIN_PPS);
    expect(clampPps(1e6)).toBe(MAX_PPS);
    expect(stepPps(100, 1)).toBeCloseTo(125);
    expect(stepPps(100, -1)).toBeCloseTo(80);
    expect(stepPps(MAX_PPS, 1)).toBe(MAX_PPS);
  });

  it("maps the slider logarithmically", () => {
    expect(sliderToPps(0)).toBeCloseTo(MIN_PPS);
    expect(sliderToPps(1)).toBeCloseTo(MAX_PPS);
    expect(sliderToPps(ppsToSlider(137))).toBeCloseTo(137);
  });

  it("fits the duration into the view", () => {
    const pps = fitPps(10_000, 1000);
    expect(msToPx(10_000, pps)).toBeLessThanOrEqual(1000);
    expect(msToPx(10_000, pps)).toBeGreaterThan(900);
  });

  it("keeps the anchor under the cursor when zooming", () => {
    // 4s under x=200 at the new zoom of 100 px/s → content x 400, scroll 200.
    expect(scrollForZoom(4000, 200, 100)).toBe(200);
    expect(scrollForZoom(500, 200, 100)).toBe(0);
  });

  it("computes the visible window", () => {
    expect(visibleRange(1000, 500, 100, 0)).toEqual({ from: 10_000, to: 15_000 });
  });
});

describe("ruler", () => {
  it("shows frames when zoomed in and seconds when zoomed out", () => {
    expect(rulerSteps(1200, 30).minorFrames).toBe(1);
    expect(rulerSteps(100, 30).majorFrames).toBe(30);
    expect(rulerSteps(10, 30).majorFrames).toBeGreaterThanOrEqual(150);
  });

  it("labels major ticks only", () => {
    const ticks = rulerTicks(100, 30, 0, 3000);
    expect(ticks.filter((t) => t.major).map((t) => t.label)).toEqual(["0s", "1s", "2s", "3s"]);
    expect(ticks.some((t) => !t.major && t.label)).toBe(false);
    expect(rulerTicks(1200, 30, 0, 200).some((t) => t.label?.endsWith("f"))).toBe(true);
  });

  it("formats frame-accurate timecodes", () => {
    expect(formatTimecode(3400, 30)).toBe("0:03:12");
    expect(formatTimecode(61_000, 30)).toBe("1:01:00");
  });
});

describe("snapping", () => {
  const targets = [
    { ms: 1000, kind: "word" as const },
    { ms: 1040, kind: "playhead" as const },
    { ms: 5000, kind: "clip" as const },
  ];

  it("snaps to the nearest target inside the threshold", () => {
    expect(snapValue(1035, targets, 50).target?.kind).toBe("playhead");
    expect(snapValue(1005, targets, 50).ms).toBe(1000);
    expect(snapValue(3000.4, targets, 50, false).target).toBeNull();
  });

  it("prefers the playhead over a word at the same distance", () => {
    const tie = [
      { ms: 1000, kind: "word" as const },
      { ms: 1000, kind: "playhead" as const },
    ];
    expect(snapValue(1010, tie, 50).target?.kind).toBe("playhead");
  });

  it("falls back to whole seconds", () => {
    const r = snapValue(2980, [], 50);
    expect(r).toEqual({ ms: 3000, target: { ms: 3000, kind: "second" } });
  });

  it("snaps a range by its closer edge", () => {
    // start 4980 (20 from 5000), end 7030 (30 from 7000s) → start wins.
    expect(snapRange(4980, 7030, targets, 50).delta).toBe(20);
  });

  it("collects targets and leaves out what is being dragged", () => {
    const p = applyEdit(DEMO_PLAN, { type: "addItem", trackKind: "text", item: { id: "t1" }, atMs: 2000 });
    const tl = resolveTimeline(p);
    const all = snapTargets(p, tl, 500);
    expect(all.some((t) => t.kind === "item" && t.ms === 2000)).toBe(true);
    expect(snapTargets(p, tl, 500, { itemIds: ["t1"] }).some((t) => t.kind === "item")).toBe(false);
  });
});

describe("trim mapping", () => {
  it("maps an output delta to source time at 1×", () => {
    const p = plainPlan();
    expect(trimClipSrcMs(p, "clip-1", "out", -1000)).toBeCloseTo(DEMO_PLAN.sources[0].durationMs - 1000);
    expect(trimClipSrcMs(p, "clip-1", "in", 1000)).toBeCloseTo(1000);
  });

  it("multiplies by speed", () => {
    const p = plainPlan(2);
    // 1s of output at 2× is 2s of source.
    expect(trimClipSrcMs(p, "clip-1", "out", -1000)).toBeCloseTo(DEMO_PLAN.sources[0].durationMs - 2000);
    expect(trimClipSrcMs(p, "clip-1", "in", 500)).toBeCloseTo(1000);
  });

  it("skips cut ranges so the output length changes by exactly the delta", () => {
    const p = DEMO_PLAN;
    const before = clipOutputLength(p, p.clips[0]);
    const src = trimClipSrcMs(p, "clip-1", "out", -2000)!;
    const after = applyEdit(p, { type: "trimClip", clipId: "clip-1", edge: "out", srcMs: src });
    expect(clipOutputLength(after, after.clips[0])).toBeCloseTo(before - 2000, 0);
  });

  it("can extend a trimmed clip back out", () => {
    const p = applyEdit(plainPlan(), { type: "trimClip", clipId: "clip-1", edge: "out", srcMs: 8000 });
    expect(trimClipSrcMs(p, "clip-1", "out", 1500)).toBeCloseTo(9500);
    expect(trimClipSrcMs(p, "clip-1", "out", 1e6)).toBe(DEMO_PLAN.sources[0].durationMs);
  });
});

describe("reorder", () => {
  const spans = [
    { outStart: 0, outEnd: 1000 },
    { outStart: 1000, outEnd: 3000 },
    { outStart: 3000, outEnd: 4000 },
  ];

  it("counts the other clips whose middle is left of the pointer", () => {
    expect(reorderIndex(spans, 0, 100)).toBe(0);
    expect(reorderIndex(spans, 0, 2500)).toBe(1);
    expect(reorderIndex(spans, 0, 3900)).toBe(2);
    expect(reorderIndex(spans, 2, 100)).toBe(0);
  });

  it("places the insert marker", () => {
    expect(insertMarkerMs(spans, 0, 2)).toBe(4000);
    expect(insertMarkerMs(spans, 2, 0)).toBe(0);
    expect(insertMarkerMs(spans, 0, 1)).toBe(3000);
  });

  it("matches moveClip semantics", () => {
    let p = applyEdit(plainPlan(), { type: "splitAt", outMs: 5000 });
    p = applyEdit(p, { type: "splitAt", outMs: 10_000 });
    const ids = p.clips.map((c) => c.id);
    const tl = resolveTimeline(p);
    const to = reorderIndex(tl.clipSpans, 0, tl.durationMs - 10);
    const moved = applyEdit(p, { type: "moveClip", clipId: ids[0], toIndex: to });
    expect(moved.clips.map((c) => c.id)).toEqual([ids[1], ids[2], ids[0]]);
  });
});

describe("marquee and ripple", () => {
  it("hits boxes the rectangle touches, in any drag direction", () => {
    const boxes = [
      { id: "a", x0: 0, x1: 50, y0: 0, y1: 30 },
      { id: "b", x0: 100, x1: 150, y0: 0, y1: 30 },
      { id: "c", x0: 0, x1: 50, y0: 40, y1: 70 },
    ];
    expect(marqueeHits({ x0: 120, y0: 20, x1: 40, y1: 5 }, boxes)).toEqual(["a", "b"]);
    expect(marqueeHits({ x0: 60, y0: 0, x1: 90, y1: 100 }, boxes)).toEqual([]);
  });

  it("closes the gap left by deleted items", () => {
    const items = [
      { id: "a", startMs: 0, endMs: 1000 },
      { id: "b", startMs: 1000, endMs: 2000 },
      { id: "c", startMs: 2500, endMs: 3000 },
    ];
    expect(rippleMoves(items, ["a"])).toEqual([
      { itemId: "b", startMs: 0 },
      { itemId: "c", startMs: 1500 },
    ]);
    expect(rippleMoves(items, ["c"])).toEqual([]);
  });
});
