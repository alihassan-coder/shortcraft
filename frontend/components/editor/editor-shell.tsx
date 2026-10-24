"use client";

import { useEffect, useSyncExternalStore } from "react";
import Link from "next/link";
import { Monitor } from "lucide-react";
import { DEMO_PLAN } from "@/lib/edit-plan/demo-plan";
import { parsePlan } from "@/lib/edit-plan/migrate";
import { resolveTimeline } from "@/lib/edit-plan/timeline";
import { deleteSelection, duplicateClip, splitAtPlayhead, toggleOriginal } from "@/lib/editor/actions";
import { playerControls } from "@/lib/editor/player";
import { togglePanel, useBreakpoint } from "@/lib/editor/layout";
import { useSaveStore } from "@/lib/editor/save";
import { dispatch, redo, selectedId, undo, usePlanStore, useUiStore } from "@/lib/editor/store";
import { TAB_KEYS, openTab } from "./assets";
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
    let timer: ReturnType<typeof setTimeout> | undefined;
    const save = useSaveStore.getState();
    const write = () => {
      timer = undefined;
      try {
        localStorage.setItem(storageKey(projectId), JSON.stringify(usePlanStore.getState().plan));
        save.setSaved();
      } catch {
        // Storage full or blocked: the edit still works, it just won't survive a reload.
        save.setError();
      }
    };
    const unsub = usePlanStore.subscribe((s, prev) => {
      if (s.plan === prev.plan) return;
      save.setSaving();
      clearTimeout(timer);
      timer = setTimeout(write, 500);
    });
    // Leaving with a pending change: write it now.
    const flush = () => timer && (clearTimeout(timer), write());
    window.addEventListener("pagehide", flush);
    const onNetwork = () => useSaveStore.getState().status !== "saving" && useSaveStore.getState().status !== "error" && save.setSaved();
    window.addEventListener("online", onNetwork);
    window.addEventListener("offline", onNetwork);
    return () => {
      flush();
      unsub();
      window.removeEventListener("pagehide", flush);
      window.removeEventListener("online", onNetwork);
      window.removeEventListener("offline", onNetwork);
    };
  }, [projectId]);
}

// Keys never fire while typing, or while a menu or dialog has focus (they own their keys).
const isTyping = (el: HTMLElement) => !!el.closest("input, textarea, select, [contenteditable=true]");
const inOverlay = (el: HTMLElement) => !!el.closest('[role=menu], [role=menubar], [role=dialog], [role=listbox]');

function useShortcuts() {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement;
      const mod = e.ctrlKey || e.metaKey;
      const ui = useUiStore.getState();
      const key = e.key.toLowerCase();

      // The palette works from anywhere, even a text field.
      if (mod && key === "k") {
        e.preventDefault();
        return ui.setDialog(ui.dialog === "palette" ? null : "palette");
      }
      if (isTyping(el) || inOverlay(el) || ui.dialog) return;

      const { plan } = usePlanStore.getState();
      const source = plan.sources[0];
      const wordId = selectedId("word");

      if (mod) {
        switch (key) {
          case "z":
            e.preventDefault();
            return e.shiftKey ? redo() : undo();
          case "y":
            e.preventDefault();
            return redo();
          case "d":
            e.preventDefault();
            return duplicateClip();
          case "e":
            e.preventDefault();
            return ui.setDialog("export");
        }
        return;
      }
      if (e.altKey) return;

      if (e.shiftKey && (e.code === "Digit0" || e.code === "Digit1")) {
        e.preventDefault();
        return ui.setPreviewZoom(e.code === "Digit0" ? "fit" : 1);
      }
      if (e.key === "?") return ui.setDialog("shortcuts");
      if (!e.shiftKey && TAB_KEYS[e.key]) return openTab(TAB_KEYS[e.key]);

      switch (e.key) {
        case "[":
          e.preventDefault();
          return togglePanel("assets");
        case "]":
          e.preventDefault();
          return togglePanel("inspector");
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
        case "K":
          playerControls.pause();
          break;
        case "j":
        case "J":
          playerControls.nudge(-1000);
          break;
        case "l":
        case "L":
          playerControls.nudge(1000);
          break;
        case ",":
          playerControls.nudge(-1000 / plan.canvas.fps);
          break;
        case ".":
          playerControls.nudge(1000 / plan.canvas.fps);
          break;
        case "Home":
          e.preventDefault();
          playerControls.seekOutputMs(0);
          break;
        case "s":
        case "S":
          e.preventDefault();
          splitAtPlayhead();
          break;
        case "o":
        case "O":
          toggleOriginal();
          break;
        case "h":
        case "H":
          if (wordId) dispatch({ type: "toggleHighlight", wordId });
          break;
        case "Delete":
        case "Backspace":
          if (ui.selection) {
            e.preventDefault();
            deleteSelection();
          }
          break;
        case "Escape":
          ui.select(null);
          break;
        case "ArrowLeft":
        case "ArrowRight": {
          e.preventDefault();
          const words = source.words;
          const src = resolveTimeline(plan, { original: ui.original }).toSource(ui.currentMs)?.srcMs ?? 0;
          let i = wordId ? words.findIndex((w) => w.id === wordId) : words.findIndex((w) => w.endMs > src);
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
