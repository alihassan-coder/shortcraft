"use client";

import { create } from "zustand";

// Save status for the menu bar. The plan autosaves to browser storage until
// projects live on the backend; this store only reports what happened.

export type SaveStatus = "saved" | "saving" | "offline" | "error";

type SaveState = {
  status: SaveStatus;
  /** When the last successful write finished (ms since epoch), or null before the first one. */
  savedAt: number | null;
  setSaving: () => void;
  setSaved: () => void;
  setError: () => void;
};

export const useSaveStore = create<SaveState>()((set) => ({
  status: "saved",
  savedAt: null,
  setSaving: () => set({ status: "saving" }),
  setSaved: () =>
    set({ status: typeof navigator !== "undefined" && !navigator.onLine ? "offline" : "saved", savedAt: Date.now() }),
  setError: () => set({ status: "error" }),
}));

/** "just now", "2 min ago", "1 h ago". */
export function relativeTime(at: number, now: number) {
  const s = Math.max(0, Math.round((now - at) / 1000));
  if (s < 45) return "just now";
  const m = Math.round(s / 60);
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h} h ago`;
  return new Date(at).toLocaleDateString();
}
