"use client";

import { useSyncExternalStore, type RefObject } from "react";
import { create } from "zustand";
import type { LayoutStorage, PanelImperativeHandle } from "react-resizable-panels";

// Editor layout state: which breakpoint we are in, which panels are collapsed,
// and which tab is showing where panels share space. UI only, never in undo.

/* ---------- Breakpoints ---------- */

export type Breakpoint = "phone" | "tablet" | "laptop" | "desktop";

const QUERIES: [Exclude<Breakpoint, "phone">, string][] = [
  ["desktop", "(min-width: 1280px)"],
  ["laptop", "(min-width: 1024px)"],
  ["tablet", "(min-width: 768px)"],
];

function subscribeBreakpoint(onChange: () => void) {
  const lists = QUERIES.map(([, q]) => window.matchMedia(q));
  lists.forEach((l) => l.addEventListener("change", onChange));
  return () => lists.forEach((l) => l.removeEventListener("change", onChange));
}

export function getBreakpoint(): Breakpoint {
  if (typeof window === "undefined") return "desktop";
  for (const [bp, q] of QUERIES) if (window.matchMedia(q).matches) return bp;
  return "phone";
}

/** Current editor breakpoint. Client-only; the server snapshot is never shown (the editor renders after hydration). */
export const useBreakpoint = () => useSyncExternalStore(subscribeBreakpoint, getBreakpoint, () => "desktop" as Breakpoint);

/* ---------- Panel sizes (pixels) ---------- */

export const SIZES = {
  desktop: {
    assets: { min: 260, max: 440, default: 320 },
    inspector: { min: 260, max: 400, default: 300, collapsed: 40 },
  },
  laptop: {
    assets: { min: 240, max: 360, default: 272 },
    inspector: { min: 240, max: 340, default: 264, collapsed: 40 },
  },
  center: { min: 360 },
  timeline: { min: 120, max: "45%", default: 200, collapsed: 32 },
  main: { min: 280 },
} as const;

/** Bump when the panel structure changes so old saved sizes are ignored. */
export const LAYOUT_VERSION = "v3";

/** localStorage that never throws (private mode, blocked storage). */
export const layoutStorage: LayoutStorage = {
  getItem: (key) => {
    try {
      return window.localStorage.getItem(key);
    } catch {
      return null;
    }
  },
  setItem: (key, value) => {
    try {
      window.localStorage.setItem(key, value);
    } catch {
      // Sizes just won't survive a reload.
    }
  },
};

/* ---------- Collapse state ---------- */

export type PanelKey = "assets" | "inspector" | "timeline";

type LayoutState = {
  collapsed: Record<PanelKey, boolean>;
  setCollapsed: (key: PanelKey, value: boolean) => void;
  /** 768–1023px: the section under the preview. */
  tabletTab: PanelKey;
  setTabletTab: (tab: PanelKey) => void;
};

export const useLayoutStore = create<LayoutState>()((set) => ({
  collapsed: { assets: false, inspector: false, timeline: false },
  setCollapsed: (key, value) =>
    set((s) => (s.collapsed[key] === value ? s : { collapsed: { ...s.collapsed, [key]: value } })),
  tabletTab: "assets",
  setTabletTab: (tabletTab) => set({ tabletTab }),
}));

// Imperative handles of the mounted panels.
const handles: Partial<Record<PanelKey, RefObject<PanelImperativeHandle | null>>> = {};

export function registerPanel(key: PanelKey, ref: RefObject<PanelImperativeHandle | null>) {
  handles[key] = ref;
  return () => {
    if (handles[key] === ref) delete handles[key];
  };
}

const handle = (key: PanelKey) => handles[key]?.current ?? null;

/** Toggle a panel the way the current breakpoint shows it (`[`, `]`, `\`, View menu). */
export function togglePanel(key: PanelKey) {
  if (getBreakpoint() === "tablet") return useLayoutStore.getState().setTabletTab(key);
  const p = handle(key);
  if (!p) return;
  if (p.isCollapsed()) p.expand();
  else p.collapse();
}

/** Make sure a panel is visible (e.g. picking an assets tab). */
export function revealPanel(key: PanelKey) {
  if (getBreakpoint() === "tablet") return useLayoutStore.getState().setTabletTab(key);
  const p = handle(key);
  if (p?.isCollapsed()) p.expand();
}

/** Collapse a panel (header buttons). */
export function collapsePanel(key: PanelKey) {
  handle(key)?.collapse();
}

/** Is the panel showing right now? (View menu check marks.) */
export function usePanelVisible(key: PanelKey, breakpoint: Breakpoint) {
  const collapsed = useLayoutStore((s) => s.collapsed[key]);
  const tabletTab = useLayoutStore((s) => s.tabletTab);
  return breakpoint === "tablet" ? tabletTab === key : !collapsed;
}
