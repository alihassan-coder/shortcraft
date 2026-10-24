"use client";

import { useEffect, useSyncExternalStore } from "react";
import Link from "next/link";
import { Monitor } from "lucide-react";
import { DEMO_PLAN } from "@/lib/edit-plan/demo-plan";
import { parsePlan } from "@/lib/edit-plan/migrate";
import { resolveTimeline } from "@/lib/edit-plan/timeline";
import { playerControls } from "@/lib/editor/player";
import { revealPanel, togglePanel, useBreakpoint } from "@/lib/editor/layout";
import { dispatch, redo, undo, usePlanStore, useUiStore } from "@/lib/editor/store";
import { TOOL_KEYS } from "./chrome";
import { Workspace } from "./workspace";

const storageKey = (id: string) => `shortcraft:plan:${id}`;

function useAutosave(projectId: string) {
  // Load once. Browser storage is a stand-in until projects live in Supabase.
  useEffect(() => {
    try {
      const raw = localStorage.getItem(storageKey(projectId));
      usePlanStore.getState().load((raw && parsePlan(JSON.parse(raw))) || DEMO_PLAN);
    } catch {
      usePlanStore.getState().load(DEMO_PLAN);
    }
    usePlanStore.temporal.getState().clear();
  }, [projectId]);

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>;
    const unsub = usePlanStore.subscribe((s) => {
      clearTimeout(timer);
      timer = setTimeout(() => {
        try {
          localStorage.setItem(storageKey(projectId), JSON.stringify(s.plan));
        } catch {
          // Storage full or blocked: the edit still works, it just won't survive a reload.
        }
      }, 500);
    });
    return () => {
      clearTimeout(timer);
      unsub();
    };
  }, [projectId]);
}

function useShortcuts() {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement;
      if (el.closest("input, textarea, [contenteditable=true]")) return;
      const mod = e.ctrlKey || e.metaKey;
      const ui = useUiStore.getState();
      const { plan } = usePlanStore.getState();
      const source = plan.sources[0];

      if (mod && e.key.toLowerCase() === "z") {
        e.preventDefault();
        if (e.shiftKey) redo();
        else undo();
        return;
      }
      if (mod && e.key.toLowerCase() === "y") {
        e.preventDefault();
        redo();
        return;
      }
      if (mod || e.altKey) return;

      if (TOOL_KEYS[e.key]) {
        ui.setTool(TOOL_KEYS[e.key]);
        return revealPanel("tools");
      }

      switch (e.key) {
        case "[":
          e.preventDefault();
          return togglePanel("tools");
        case "]":
          e.preventDefault();
          return togglePanel("transcript");
        case "\\":
          e.preventDefault();
          return togglePanel("timeline");
      }

      switch (e.key) {
        case " ":
          e.preventDefault();
          playerControls.toggle();
          break;
        case "k":
          playerControls.pause();
          break;
        case "j":
          playerControls.nudge(-1000);
          break;
        case "l":
          playerControls.nudge(1000);
          break;
        case "h":
          if (ui.selectedWordId) dispatch({ type: "toggleHighlight", wordId: ui.selectedWordId });
          break;
        case "Delete":
        case "Backspace":
          if (ui.selectedWordId) {
            e.preventDefault();
            dispatch({ type: "toggleWordCut", sourceId: source.id, wordId: ui.selectedWordId });
          }
          break;
        case "Escape":
          ui.selectWord(null);
          ui.selectZoom(null);
          break;
        case "ArrowLeft":
        case "ArrowRight": {
          e.preventDefault();
          const words = source.words;
          const src = resolveTimeline(plan, { original: ui.original }).toSource(ui.currentMs)?.srcMs ?? 0;
          let i = ui.selectedWordId
            ? words.findIndex((w) => w.id === ui.selectedWordId)
            : words.findIndex((w) => w.endMs > src);
          i = Math.max(0, Math.min(words.length - 1, i + (e.key === "ArrowRight" ? 1 : -1)));
          ui.selectWord(words[i].id);
          playerControls.seekSourceMs(source.id, words[i].startMs);
          break;
        }
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
}

// The editor depends on the browser (player, storage), so it renders after hydration.
const noop = () => () => {};
const useIsClient = () => useSyncExternalStore(noop, () => true, () => false);

export function EditorShell({ projectId }: { projectId: string }) {
  const isClient = useIsClient();
  useAutosave(projectId);
  useShortcuts();

  if (!isClient) {
    return (
      <div className="grid h-dvh place-items-center bg-white">
        <div className="flex items-center gap-3 text-sm text-muted-foreground">
          <span className="size-2 animate-pulse rounded-full bg-rec" /> Opening editor…
        </div>
      </div>
    );
  }

  return <EditorLayout />;
}

function EditorLayout() {
  const breakpoint = useBreakpoint();
  if (breakpoint !== "phone") return <Workspace breakpoint={breakpoint} />;

  return (
    <>
      <div className="flex min-h-dvh flex-col items-center justify-center px-8 text-center">
        <Monitor className="size-10 text-ink-2" strokeWidth={1.5} />
        <h1 className="mt-6 text-2xl font-semibold tracking-[-0.02em]">The editor needs a bigger screen</h1>
        <p className="mt-3 max-w-sm text-muted-foreground">
          Open this page on a tablet, laptop or desktop to edit your video. A simpler phone editor is on the way.
        </p>
        <Link href="/" className="mt-8 inline-flex h-11 items-center rounded-full bg-ink px-6 text-[15px] font-medium text-white">
          Back to home
        </Link>
      </div>
    </>
  );
}
