"use client";

import type { PlayerRef } from "@remotion/player";
import { msToFrames, resolveTimeline } from "@/lib/edit-plan/timeline";
import { usePlanStore, useUiStore } from "./store";

// One shared handle to the Remotion Player so the transcript, timeline and
// keyboard shortcuts can control playback without prop drilling.
let player: PlayerRef | null = null;

export const registerPlayer = (ref: PlayerRef | null) => {
  player = ref;
};

const fps = () => usePlanStore.getState().plan.canvas.fps;

export const playerControls = {
  toggle: () => player?.toggle(),
  pause: () => player?.pause(),
  play: () => player?.play(),
  seekOutputMs(ms: number) {
    const t = Math.max(0, ms);
    player?.seekTo(msToFrames(t, fps()));
    useUiStore.getState().setCurrentMs(t);
  },
  seekSourceMs(sourceId: string, srcMs: number) {
    const { plan } = usePlanStore.getState();
    const original = useUiStore.getState().original;
    this.seekOutputMs(resolveTimeline(plan, { original }).toOutputNearest(sourceId, srcMs));
  },
  nudge(ms: number) {
    this.seekOutputMs(useUiStore.getState().currentMs + ms);
  },
};
