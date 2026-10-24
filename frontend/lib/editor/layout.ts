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
  tools: { min: 240, max: 420, default: 300 },
  side: { min: 260, max: 420, default: 320 },
  transcript: { min: 280, max: 480, default: 340, collapsed: 40 },
  center: { min: 360 },
  timeline: { min: 120, max: "45%", default: 200, collapsed: 32 },
  main: { min: 280 },
} as const;

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

export type PanelKey = "tools" | "transcript" | "timeline";
export type SideTab = "tools" | "transcript";

type LayoutState = {
  collapsed: Record<PanelKey | "side", boolean>;
  setCollapsed: (key: PanelKey | "side", value: boolean) => void;
  /** 1024–1279px: what the left panel shows. */
  sideTab: SideTab;
  setSideTab: (tab: SideTab) => void;
  /** 768–1023px: the section under the preview. */
  tabletTab: PanelKey;
  setTabletTab: (tab: PanelKey) => void;
};

export const useLayoutStore = create<LayoutState>()((set) => ({
  collapsed: { tools: false, transcript: false, timeline: false, side: false },
  setCollapsed: (key, value) =>
    set((s) => (s.collapsed[key] === value ? s : { collapsed: { ...s.collapsed, [key]: value } })),
  sideTab: "tools",
  setSideTab: (sideTab) => set({ sideTab }),
  tabletTab: "tools",
  setTabletTab: (tabletTab) => set({ tabletTab }),
}));

// Imperative handles of the mounted panels. "side" is the shared left panel at 1024–1279px.
type HandleKey = PanelKey | "side";
const handles: Partial<Record<HandleKey, RefObject<PanelImperativeHandle | null>>> = {};

export function registerPanel(key: HandleKey, ref: RefObject<PanelImperativeHandle | null>) {
  handles[key] = ref;
  return () => {
    if (handles[key] === ref) delete handles[key];
  };
}

const handle = (key: HandleKey) => handles[key]?.current ?? null;

/** Toggle a panel the way the current breakpoint shows it (`[`, `]`, `\` and the header buttons). */
export function togglePanel(key: PanelKey) {
  const bp = getBreakpoint();
  const s = useLayoutStore.getState();
  if (bp === "tablet") return s.setTabletTab(key);
  if (bp === "laptop" && key !== "timeline") {
    const side = handle("side");
    if (!side) return;
    if (side.isCollapsed()) {
      s.setSideTab(key);
      side.expand();
    } else if (s.sideTab !== key) s.setSideTab(key);
    else side.collapse();
    return;
  }
  const p = handle(key);
  if (!p) return;
  if (p.isCollapsed()) p.expand();
  else p.collapse();
}

/** Make sure a panel is visible (e.g. picking a tool in the rail). */
export function revealPanel(key: PanelKey) {
  const bp = getBreakpoint();
  const s = useLayoutStore.getState();
  if (bp === "tablet") return s.setTabletTab(key);
  if (bp === "laptop" && key !== "timeline") {
    s.setSideTab(key);
    const side = handle("side");
    if (side?.isCollapsed()) side.expand();
    return;
  }
  const p = handle(key);
  if (p?.isCollapsed()) p.expand();
}

/** Collapse a panel (header buttons). */
export function collapsePanel(key: PanelKey | "side") {
  handle(key)?.collapse();
}
