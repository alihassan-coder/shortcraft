"use client";

import { create } from "zustand";
import { temporal } from "zundo";
import { applyEdit, applyEdits, type EditCommand } from "@/lib/edit-plan/commands";
import { DEMO_PLAN } from "@/lib/edit-plan/demo-plan";
import type { EditPlan } from "@/lib/edit-plan/schema";
import { resolveTimeline } from "@/lib/edit-plan/timeline";

// Plan store: the edit plan plus undo/redo (zundo). The only way to change the
// plan is dispatch(command), which runs applyEdit, so every rule lives there.

type PlanState = {
  plan: EditPlan;
  /** Replace the whole plan (loading a project). Not for edits. */
  load: (plan: EditPlan) => void;
  dispatch: (cmd: EditCommand | EditCommand[]) => void;
};

export const usePlanStore = create<PlanState>()(
  temporal(
    (set, get) => ({
      plan: DEMO_PLAN,
      load: (plan) => set({ plan }),
      dispatch: (cmd) => {
        const current = get().plan;
        const next = Array.isArray(cmd) ? applyEdits(current, cmd) : applyEdit(current, cmd);
        if (next !== current) set({ plan: next });
      },
    }),
    {
      limit: 100,
      partialize: (s) => ({ plan: s.plan }),
      equality: (a, b) => a.plan === b.plan,
      // Group rapid changes (slider drags) into one undo step.
      handleSet: (handleSet) => {
        let timer: ReturnType<typeof setTimeout> | null = null;
        let pending = false;
        return (...args: Parameters<typeof handleSet>) => {
          if (!pending) {
            handleSet(...args);
            pending = true;
          }
          if (timer) clearTimeout(timer);
          timer = setTimeout(() => (pending = false), 400);
        };
      },
    },
  ),
);

export const dispatch = (cmd: EditCommand | EditCommand[]) => usePlanStore.getState().dispatch(cmd);
export const undo = () => usePlanStore.temporal.getState().undo();
export const redo = () => usePlanStore.temporal.getState().redo();

/** The resolved timeline for the current plan (cached per plan). */
export function useTimeline(opts: { original?: boolean } = {}) {
  const plan = usePlanStore((s) => s.plan);
  const original = useUiStore((s) => s.original);
  return resolveTimeline(plan, { original: opts.original ?? original });
}

/* ---------- UI state (not part of undo history) ---------- */

export type Tool = "style" | "captions" | "cuts" | "zoom" | "music" | "hook";

type UiState = {
  tool: Tool;
  setTool: (tool: Tool) => void;
  currentMs: number; // output time
  setCurrentMs: (ms: number) => void;
  playing: boolean;
  setPlaying: (v: boolean) => void;
  original: boolean;
  setOriginal: (v: boolean) => void;
  safeZones: boolean;
  setSafeZones: (v: boolean) => void;
  selectedWordId: string | null;
  selectWord: (id: string | null) => void;
  selectedZoomId: string | null;
  selectZoom: (id: string | null) => void;
};

export const useUiStore = create<UiState>()((set) => ({
  tool: "style",
  setTool: (tool) => set({ tool }),
  currentMs: 0,
  setCurrentMs: (currentMs) => set({ currentMs }),
  playing: false,
  setPlaying: (playing) => set({ playing }),
  original: false,
  setOriginal: (original) => set({ original }),
  safeZones: false,
  setSafeZones: (safeZones) => set({ safeZones }),
  selectedWordId: null,
  selectWord: (selectedWordId) => set({ selectedWordId }),
  selectedZoomId: null,
  selectZoom: (selectedZoomId) => set(selectedZoomId ? { selectedZoomId, tool: "zoom" } : { selectedZoomId }),
}));
