"use client";

import type { EditCommand } from "@/lib/edit-plan/commands";
import type { EditPlan } from "@/lib/edit-plan/schema";
import { dispatch, usePlanStore } from "./store";

// Stand-in for the backend Director agent. It understands a handful of
// requests with keyword rules and answers with edit commands, exactly like
// the real agent will. The editor applies them through the same dispatch.

type Result = { commands: EditCommand[]; changes: string[] };
type Rule = { test: RegExp; plan: (p: EditPlan, text: string) => Result };

const RULES: Rule[] = [
  {
    test: /energ|hype|faster|punch(y|ier)|exciting/i,
    plan: () => ({
      commands: [
        { type: "setVibe", vibe: "energetic" },
        { type: "setCutRules", rules: { silence: true, filler: true } },
        { type: "setCaptions", captions: { showEmojis: true } },
        { type: "setZoomsEnabled", enabled: true },
        { type: "updateAllZooms", patch: { style: "punch", scale: 1.22 } },
        { type: "setMusic", music: { trackId: "summer-fun", volume: 0.55 } },
      ],
      changes: ["Removed all pauses and filler words", "Zoom-ins set to Punch", "Captions set to Bold Pop", "Music: Summer Fun"],
    }),
  },
  {
    test: /calm|clean|simple|minimal|professional|subtle/i,
    plan: () => ({
      commands: [
        { type: "setVibe", vibe: "clean" },
        { type: "setCaptions", captions: { showEmojis: false } },
        { type: "updateAllZooms", patch: { style: "smooth", scale: 1.12 } },
        { type: "setMusic", music: { trackId: "just-chill", volume: 0.35 } },
      ],
      changes: ["Captions set to Clean", "Emojis turned off", "Softer, smoother zoom-ins", "Music: Just Chill"],
    }),
  },
  {
    test: /story|emotional|cinematic/i,
    plan: () => ({
      commands: [
        { type: "setVibe", vibe: "story" },
        { type: "setCaptions", captions: { showEmojis: false } },
        { type: "setMusic", music: { trackId: "a-new-life" } },
      ],
      changes: ["Captions set to Story", "Emojis turned off", "Music: A New Life"],
    }),
  },
  {
    test: /(no|remove|turn off|without) (the )?music/i,
    plan: () => ({ commands: [{ type: "setMusic", music: { trackId: null } }], changes: ["Removed the music"] }),
  },
  {
    test: /(no|remove|turn off|without) (the )?emoji/i,
    plan: () => ({ commands: [{ type: "setCaptions", captions: { showEmojis: false } }], changes: ["Turned off emojis"] }),
  },
  {
    test: /(bigger|larger) captions|captions (bigger|larger)/i,
    plan: (p) => {
      const size = Math.min(160, p.captions.size + 14);
      return { commands: [{ type: "setCaptions", captions: { size } }], changes: [`Caption size ${size}`] };
    },
  },
  {
    test: /smaller captions|captions smaller/i,
    plan: (p) => {
      const size = Math.max(40, p.captions.size - 14);
      return { commands: [{ type: "setCaptions", captions: { size } }], changes: [`Caption size ${size}`] };
    },
  },
  {
    test: /(no|remove|turn off|without) (the )?(hook|title)/i,
    plan: () => ({ commands: [{ type: "setHook", hook: { enabled: false } }], changes: ["Removed the hook title"] }),
  },
  {
    test: /(no|remove|turn off|without) (the )?zoom/i,
    plan: () => ({ commands: [{ type: "setZoomsEnabled", enabled: false }], changes: ["Turned off zoom-ins"] }),
  },
  {
    test: /square|1:1/i,
    plan: () => ({ commands: [{ type: "setCanvas", canvas: { aspect: "1:1" } }], changes: ["Canvas set to 1:1 square"] }),
  },
  {
    // "remove the part about X" / "cut the part where I say X"
    test: /(remove|cut|delete) (the part|the bit|the line)? ?(about|where i say|saying)? ?(.+)/i,
    plan: (p, text) => {
      const m = text.match(/(?:about|say|saying)\s+(.+)$/i) ?? text.match(/(?:remove|cut|delete)\s+(.+)$/i);
      const target = m?.[1]?.toLowerCase().replace(/[^\w\s']/g, "").trim().split(/\s+/)[0];
      if (!target) return { commands: [], changes: [] };
      for (const source of p.sources) {
        const words = source.words;
        const clean = (s: string) => s.toLowerCase().replace(/[^\w']/g, "");
        const idx = words.findIndex((w) => clean(w.text) === target);
        if (idx < 0) continue;
        let start = idx;
        while (start > 0 && !/[.!?]$/.test(words[start - 1].text)) start--;
        let end = idx;
        while (end < words.length - 1 && !/[.!?]$/.test(words[end].text)) end++;
        const sentence = words.slice(start, end + 1).map((w) => w.text).join(" ");
        return {
          commands: [
            {
              type: "cutRange",
              sourceId: source.id,
              startMs: words[start].startMs,
              endMs: words[end].endMs,
              note: `Removed on request: “${target}”`,
            },
          ],
          changes: [`Cut the sentence “${sentence}”`],
        };
      }
      return { commands: [], changes: [] };
    },
  },
];

export const PROMPT_SUGGESTIONS = [
  "Make it more energetic",
  "Make it calmer",
  "Remove the part about captions",
  "Bigger captions",
  "No music",
];

export function runPrompt(text: string): { ok: boolean; changes: string[] } {
  const plan = usePlanStore.getState().plan;
  const results = RULES.filter((r) => r.test.test(text)).map((r) => r.plan(plan, text));
  const commands = results.flatMap((r) => r.commands);
  if (!commands.length) return { ok: false, changes: [] };
  dispatch(commands);
  return { ok: true, changes: results.flatMap((r) => r.changes) };
}
