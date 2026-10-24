import { DEFAULT_CLIP_LOOK, type Cut, type EditPlan, type Word, type Zoom } from "./schema";

// A hand-written plan for /media/sample/demo-talk.mp4, shaped exactly like
// what the backend agents will return. Word timings are approximate because
// the stock clip has no speech audio; a real upload gets real timestamps.

type Token = [text: string, durationMs: number, opts?: { filler?: boolean; pauseAfter?: number }];

const SCRIPT: Token[] = [
  ["So", 220], ["um,", 380, { filler: true, pauseAfter: 420 }],
  ["if", 140], ["your", 160], ["videos", 300], ["are", 120], ["not", 180], ["getting—", 360, { pauseAfter: 300 }],
  ["if", 140], ["your", 160], ["videos", 300], ["aren't", 240], ["getting", 260], ["views,", 420, { pauseAfter: 160 }],
  ["it's", 160], ["probably", 340], ["the", 100], ["first", 260], ["three", 240], ["seconds.", 520, { pauseAfter: 900 }],
  ["Uh,", 360, { filler: true, pauseAfter: 200 }],
  ["people", 280], ["decide", 320], ["to", 100], ["scroll", 300], ["super", 260], ["fast.", 420, { pauseAfter: 350 }],
  ["So", 180], ["here's", 220], ["the", 100], ["trick:", 460, { pauseAfter: 260 }],
  ["start", 260], ["with", 140], ["your", 160], ["strongest", 400], ["line,", 360, { pauseAfter: 120 }],
  ["add", 200], ["big", 220], ["captions,", 460, { pauseAfter: 100 }],
  ["and", 120], ["like,", 300, { filler: true }], ["cut", 220], ["every", 240], ["pause.", 460, { pauseAfter: 700 }],
  ["That's", 240], ["it.", 300, { pauseAfter: 180 }], ["Try", 220], ["it", 120], ["today.", 520],
];

const SRC = "src-1";
const DURATION = 16850;

function buildWords(): { words: Word[]; pauses: [number, number][] } {
  const words: Word[] = [];
  const pauses: [number, number][] = [];
  let t = 350; // breath before the first word
  pauses.push([0, t]);
  SCRIPT.forEach(([text, dur, opts], i) => {
    words.push({ id: `w${i}`, text, startMs: t, endMs: t + dur, filler: opts?.filler });
    t += dur;
    if (opts?.pauseAfter) {
      if (opts.pauseAfter >= 400) pauses.push([t, t + opts.pauseAfter]);
      t += opts.pauseAfter;
    }
  });
  // Squeeze the script into the clip length (it ends ~0.3s before the clip does).
  const k = Math.min(1, (DURATION - 350) / t);
  const r = (ms: number) => Math.round(ms * k);
  return {
    words: words.map((w) => ({ ...w, startMs: r(w.startMs), endMs: r(w.endMs) })),
    pauses: pauses.map(([s, e]) => [r(s), r(e)] as [number, number]),
  };
}

const { words, pauses } = buildWords();

const cuts: Cut[] = [
  ...pauses.map(([s, e], i): Cut => ({ id: `silence-${i}`, sourceId: SRC, startMs: s, endMs: e, reason: "silence" })),
  ...words
    .filter((w) => w.filler)
    .map((w): Cut => ({ id: `filler-${w.id}`, sourceId: SRC, startMs: w.startMs, endMs: w.endMs, reason: "filler" })),
  {
    id: "retake-0",
    sourceId: SRC,
    startMs: words[2].startMs,
    endMs: words[8].startMs,
    reason: "retake",
    note: "You said this line twice. Kept the second, clearer take.",
  },
];

const zoom = (id: string, from: number, to: number, scale: number, style: Zoom["style"], focusY = 0.32): Zoom => ({
  id,
  sourceId: SRC,
  startMs: words[from].startMs,
  endMs: words[to].endMs,
  scale,
  style,
  focusX: 0.5,
  focusY,
});

const wid = (text: string, nth = 0) => words.filter((w) => w.text.replace(/[^\w']/g, "") === text)[nth]?.id ?? "";

export const DEMO_PLAN: EditPlan = {
  version: 3,
  id: "demo",
  title: "Morning tip — first three seconds",
  vibe: "energetic",
  canvas: { aspect: "9:16", width: 1080, height: 1920, fps: 30, background: { type: "blur", color: "#000000" } },
  sources: [
    {
      id: SRC,
      src: "/media/sample/demo-talk.mp4",
      poster: "/media/sample/demo-talk.jpg",
      width: 720,
      height: 1280,
      durationMs: DURATION,
      words,
    },
  ],
  clips: [{ id: "clip-1", sourceId: SRC, inMs: 0, outMs: DURATION, ...structuredClone(DEFAULT_CLIP_LOOK) }],
  cuts: { items: cuts, silence: true, filler: true, retake: true, restored: [] },
  captions: {
    enabled: true,
    presetId: "bold-pop",
    size: 108,
    positionY: 0.68,
    wordsPerLine: 2,
    showEmojis: true,
    highlights: ["views", "three", "seconds", "scroll", "trick", "strongest", "captions", "today"].map((t) => wid(t)),
    emojis: { [wid("views")]: "👀", [wid("seconds")]: "⏱️", [wid("scroll")]: "📱", [wid("trick")]: "💡", [wid("today")]: "🔥" },
    edits: {},
  },
  zooms: {
    enabled: true,
    items: [
      zoom("z1", 16, 19, 1.2, "punch"),
      zoom("z2", 28, 30, 1.25, "punch"),
      zoom("z3", 31, 38, 1.12, "push", 0.35),
      zoom("z4", 46, 48, 1.18, "smooth"),
    ],
  },
  tracks: [],
  progressBar: { enabled: false, position: "bottom", color: "#ffffff", thickness: 14 },
  music: { trackId: "summer-fun", volume: 0.5, ducking: true, duckTo: 0.25, fadeInMs: 600, fadeOutMs: 1200 },
  hook: {
    enabled: true,
    text: "Your first 3 seconds are killing your views",
    options: [
      "Your first 3 seconds are killing your views",
      "Why nobody watches past second 3",
      "Fix this and your views go up",
    ],
    durationMs: 2600,
  },
  voice: { enhance: true },
};
