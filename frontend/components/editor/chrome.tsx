"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useStore } from "zustand";
import { toast } from "sonner";
import { CloudOff, Download, Redo2, Search, TriangleAlert, Undo2 } from "lucide-react";
import { LogoMark } from "@/components/brand/logo";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import {
  Menubar,
  MenubarCheckboxItem,
  MenubarContent,
  MenubarItem,
  MenubarMenu,
  MenubarRadioGroup,
  MenubarRadioItem,
  MenubarSeparator,
  MenubarShortcut,
  MenubarSub,
  MenubarSubContent,
  MenubarSubTrigger,
  MenubarTrigger,
} from "@/components/ui/menubar";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import {
  comingSoon,
  deleteSelection,
  duplicateClip,
  focusTitle,
  keyLabel,
  splitAtPlayhead,
  toggleOriginal,
} from "@/lib/editor/actions";
import { togglePanel, useBreakpoint, usePanelVisible } from "@/lib/editor/layout";
import { relativeTime, useSaveStore } from "@/lib/editor/save";
import { dispatch, redo, undo, usePlanStore, useUiStore, type PreviewZoom } from "@/lib/editor/store";
import { cn } from "@/lib/utils";
import { IconButton } from "./controls";

/* ---------- Menu bar ---------- */

const TRIGGER = "h-7 rounded-[8px] px-2 text-[13px] font-normal text-ink-2 hover:bg-surface hover:text-ink aria-expanded:bg-surface aria-expanded:text-ink";
const CONTENT = "min-w-56 rounded-[12px] p-1";

function Shortcut({ keys }: { keys: string }) {
  return <MenubarShortcut className="font-mono text-[11px] tracking-normal">{keyLabel(keys)}</MenubarShortcut>;
}

function EditorMenus() {
  const router = useRouter();
  const breakpoint = useBreakpoint();
  const canUndo = useStore(usePlanStore.temporal, (s) => s.pastStates.length > 0);
  const canRedo = useStore(usePlanStore.temporal, (s) => s.futureStates.length > 0);
  const selection = useUiStore((s) => s.selection);
  const { safeZones, setSafeZones, original, previewZoom, setPreviewZoom, setDialog } = useUiStore();
  const assets = usePanelVisible("assets", breakpoint);
  const inspector = usePanelVisible("inspector", breakpoint);
  const timeline = usePanelVisible("timeline", breakpoint);
  const renaming = useRef(false);

  return (
    <Menubar className="h-8 gap-0 border-0 p-0 shadow-none">
      <MenubarMenu>
        <MenubarTrigger className={TRIGGER}>File</MenubarTrigger>
        <MenubarContent
          className={CONTENT}
          onCloseAutoFocus={(e) => {
            if (!renaming.current) return;
            e.preventDefault();
            renaming.current = false;
            focusTitle();
          }}
        >
          <MenubarItem onSelect={() => (renaming.current = true)}>Rename…</MenubarItem>
          <MenubarItem onSelect={() => comingSoon("Duplicating projects")}>Duplicate project</MenubarItem>
          <MenubarSeparator />
          <MenubarItem onSelect={() => setDialog("export")}>
            Export…
            <Shortcut keys="mod+E" />
          </MenubarItem>
          <MenubarSeparator />
          <MenubarItem onSelect={() => router.push("/")}>Back to projects</MenubarItem>
        </MenubarContent>
      </MenubarMenu>

      <MenubarMenu>
        <MenubarTrigger className={TRIGGER}>Edit</MenubarTrigger>
        <MenubarContent className={CONTENT}>
          <MenubarItem disabled={!canUndo} onSelect={undo}>
            Undo
            <Shortcut keys="mod+Z" />
          </MenubarItem>
          <MenubarItem disabled={!canRedo} onSelect={redo}>
            Redo
            <Shortcut keys="mod+shift+Z" />
          </MenubarItem>
          <MenubarSeparator />
          <MenubarItem onSelect={splitAtPlayhead} data-action="split">
            Split at playhead
            <Shortcut keys="S" />
          </MenubarItem>
          <MenubarItem onSelect={() => duplicateClip()}>
            Duplicate clip
            <Shortcut keys="mod+D" />
          </MenubarItem>
          <MenubarItem disabled={!selection} onSelect={deleteSelection}>
            {selection?.kind === "word" ? "Cut or restore word" : "Delete selection"}
            <Shortcut keys="delete" />
          </MenubarItem>
          <MenubarSeparator />
          <MenubarItem onSelect={() => setDialog("palette")}>
            Find an action…
            <Shortcut keys="mod+K" />
          </MenubarItem>
        </MenubarContent>
      </MenubarMenu>

      <MenubarMenu>
        <MenubarTrigger className={TRIGGER}>View</MenubarTrigger>
        <MenubarContent className={CONTENT}>
          <MenubarCheckboxItem checked={assets} onSelect={() => togglePanel("assets")}>
            Assets
            <Shortcut keys="[" />
          </MenubarCheckboxItem>
          <MenubarCheckboxItem checked={inspector} onSelect={() => togglePanel("inspector")}>
            Inspector
            <Shortcut keys="]" />
          </MenubarCheckboxItem>
          <MenubarCheckboxItem checked={timeline} onSelect={() => togglePanel("timeline")}>
            Timeline
            <Shortcut keys="\" />
          </MenubarCheckboxItem>
          <MenubarSeparator />
          <MenubarCheckboxItem checked={safeZones} onSelect={() => setSafeZones(!safeZones)}>
            Safe zones
          </MenubarCheckboxItem>
          <MenubarCheckboxItem checked={original} onSelect={toggleOriginal}>
            Show original
            <Shortcut keys="O" />
          </MenubarCheckboxItem>
          <MenubarSeparator />
          <MenubarSub>
            <MenubarSubTrigger>Preview zoom</MenubarSubTrigger>
            <MenubarSubContent className={CONTENT}>
              <MenubarRadioGroup value={String(previewZoom)} onValueChange={(v) => setPreviewZoom((v === "fit" ? "fit" : Number(v)) as PreviewZoom)}>
                <MenubarRadioItem value="fit">
                  Fit
                  <Shortcut keys="shift+0" />
                </MenubarRadioItem>
                <MenubarRadioItem value="0.5">50%</MenubarRadioItem>
                <MenubarRadioItem value="1">
                  100%
                  <Shortcut keys="shift+1" />
                </MenubarRadioItem>
              </MenubarRadioGroup>
            </MenubarSubContent>
          </MenubarSub>
        </MenubarContent>
      </MenubarMenu>

      <MenubarMenu>
        <MenubarTrigger className={TRIGGER}>Help</MenubarTrigger>
        <MenubarContent className={CONTENT}>
          <MenubarItem onSelect={() => setDialog("shortcuts")}>
            Keyboard shortcuts
            <Shortcut keys="?" />
          </MenubarItem>
          <MenubarItem onSelect={() => comingSoon("Sending feedback from the editor")}>Send feedback</MenubarItem>
        </MenubarContent>
      </MenubarMenu>
    </Menubar>
  );
}

/* ---------- Save status ---------- */

function useNow(intervalMs: number) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(t);
  }, [intervalMs]);
  return now;
}

function SaveStatus() {
  const { status, savedAt } = useSaveStore();
  const now = useNow(20_000);
  const content = {
    saving: { icon: <span className="size-1.5 animate-pulse rounded-full bg-muted-foreground" />, text: "Saving…" },
    saved: {
      icon: <span className="size-1.5 rounded-full bg-emerald-500" />,
      text: savedAt ? `Saved ${relativeTime(savedAt, Math.max(now, savedAt))}` : "Saved",
    },
    offline: { icon: <CloudOff className="size-3.5" />, text: "Offline – saved in browser" },
    error: { icon: <TriangleAlert className="size-3.5 text-cut" />, text: "Not saved – browser storage is full or blocked" },
  }[status];
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span
          role="status"
          data-save-status={status}
          className={cn("hidden h-7 items-center gap-1.5 rounded-[8px] px-1.5 text-xs whitespace-nowrap text-muted-foreground md:flex", status === "error" && "text-cut")}
        >
          {content.icon}
          {content.text}
        </span>
      </TooltipTrigger>
      <TooltipContent>
        {savedAt ? `Last saved ${new Date(savedAt).toLocaleTimeString()} in this browser` : "Changes save automatically in this browser"}
      </TooltipContent>
    </Tooltip>
  );
}

/* ---------- Top bar ---------- */

export function TopBar() {
  const title = usePlanStore((s) => s.plan.title);
  const canUndo = useStore(usePlanStore.temporal, (s) => s.pastStates.length > 0);
  const canRedo = useStore(usePlanStore.temporal, (s) => s.futureStates.length > 0);
  const setDialog = useUiStore((s) => s.setDialog);

  return (
    <header className="flex h-11 shrink-0 items-center gap-1 border-b bg-white pr-2 pl-1.5">
      <Tooltip>
        <TooltipTrigger asChild>
          <Link href="/" className="grid size-8 place-items-center rounded-[10px] hover:bg-surface" aria-label="Back to projects">
            <LogoMark className="h-[18px] w-[12px]" />
          </Link>
        </TooltipTrigger>
        <TooltipContent side="bottom">Back to projects</TooltipContent>
      </Tooltip>
      <EditorMenus />
      <span className="mx-1.5 h-4 w-px bg-line" aria-hidden />
      <input
        id="project-title"
        value={title}
        onChange={(e) => dispatch({ type: "setTitle", title: e.target.value })}
        onKeyDown={(e) => {
          e.stopPropagation();
          if (e.key === "Enter" || e.key === "Escape") (e.target as HTMLInputElement).blur();
        }}
        aria-label="Project name"
        className="h-7 w-[min(280px,22vw)] min-w-[120px] truncate rounded-[8px] px-1.5 text-[13px] font-medium outline-none hover:bg-surface focus:bg-surface focus:ring-1 focus:ring-line"
      />
      <SaveStatus />

      <div className="ml-auto flex items-center gap-1">
        <IconButton label="Undo" shortcut="mod+Z" disabled={!canUndo} onClick={undo} side="bottom">
          <Undo2 className="size-4" />
        </IconButton>
        <IconButton label="Redo" shortcut="mod+shift+Z" disabled={!canRedo} onClick={redo} side="bottom">
          <Redo2 className="size-4" />
        </IconButton>
        <span className="mx-1 h-4 w-px bg-line" aria-hidden />
        <button
          onClick={() => setDialog("palette")}
          aria-label="Search actions"
          className="hidden h-8 w-[208px] items-center gap-2 rounded-[10px] border bg-white px-2.5 text-[13px] text-muted-foreground hover:border-ink/25 hover:text-ink-2 lg:flex"
        >
          <Search className="size-3.5" />
          Search or ask…
          <kbd className="ml-auto rounded-[5px] bg-surface px-1.5 py-0.5 font-mono text-[11px] text-ink-2">{keyLabel("mod+K")}</kbd>
        </button>
        <IconButton label="Search actions" shortcut="mod+K" onClick={() => setDialog("palette")} side="bottom" className="lg:hidden">
          <Search className="size-4" />
        </IconButton>
        <button
          onClick={() => setDialog("export")}
          className="ml-1 flex h-8 items-center gap-1.5 rounded-full bg-ink px-3.5 text-[13px] font-medium text-white hover:bg-ink-2"
        >
          <Download className="size-3.5" /> Export
        </button>
      </div>
    </header>
  );
}

/* ---------- Dialogs ---------- */

const PRESETS = [
  { id: "tiktok", label: "TikTok", note: "1080×1920 · 30fps" },
  { id: "reels", label: "Instagram Reels", note: "1080×1920 · 30fps" },
  { id: "shorts", label: "YouTube Shorts", note: "1080×1920 · 30fps" },
];

export function EditorDialogs() {
  const dialog = useUiStore((s) => s.dialog);
  const setDialog = useUiStore((s) => s.setDialog);
  const close = (open: boolean) => !open && setDialog(null);
  return (
    <>
      <ExportDialog open={dialog === "export"} onOpenChange={close} />
      <ShortcutsDialog open={dialog === "shortcuts"} onOpenChange={close} />
    </>
  );
}

function ExportDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (v: boolean) => void }) {
  const [preset, setPreset] = useState("tiktok");
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="rounded-[20px] p-6 sm:max-w-[420px]">
        <DialogTitle className="text-lg font-semibold">Export video</DialogTitle>
        <DialogDescription>Choose where you&apos;ll post it. We size and frame it for you.</DialogDescription>
        <div className="mt-1 space-y-1.5">
          {PRESETS.map((p) => (
            <button
              key={p.id}
              onClick={() => setPreset(p.id)}
              aria-pressed={preset === p.id}
              className={cn(
                "flex h-12 w-full items-center justify-between rounded-[12px] border px-3.5 text-left",
                preset === p.id ? "border-ink" : "hover:bg-surface",
              )}
            >
              <span className="text-sm font-medium">{p.label}</span>
              <span className="font-mono text-xs text-muted-foreground">{p.note}</span>
            </button>
          ))}
        </div>
        <p className="rounded-[12px] bg-surface p-3.5 text-[13px] text-ink-2">
          Rendering runs on our servers and arrives with the backend. Your edit is saved and ready.
        </p>
        <button
          onClick={() => {
            onOpenChange(false);
            toast("Export isn't available yet", { description: "Rendering arrives with the backend. Your edit is saved." });
          }}
          className="h-10 w-full rounded-full bg-ink text-sm font-medium text-white hover:bg-ink-2"
        >
          Export MP4
        </button>
      </DialogContent>
    </Dialog>
  );
}

const SHORTCUTS: [string, string][] = [
  ["Space", "Play / pause"],
  ["J / L", "Back / forward 1 second"],
  ["K", "Pause"],
  ["← / →", "Previous / next word"],
  ["S", "Split at playhead"],
  ["delete", "Delete selection (cut a selected word)"],
  ["mod+D", "Duplicate clip"],
  ["H", "Highlight selected word"],
  ["O", "Show original / edited"],
  ["1 – 0", "Switch assets tab"],
  ["[", "Show / hide assets"],
  ["]", "Show / hide inspector"],
  ["\\", "Show / hide timeline"],
  ["mod+K", "Command palette"],
  ["mod+Z", "Undo"],
  ["mod+shift+Z", "Redo"],
  ["Escape", "Clear selection"],
];

function ShortcutsDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (v: boolean) => void }) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="rounded-[20px] p-6 sm:max-w-[440px]">
        <DialogTitle className="text-lg font-semibold">Keyboard shortcuts</DialogTitle>
        <DialogDescription className="sr-only">All editor shortcuts</DialogDescription>
        <dl className="-mx-1 max-h-[60vh] divide-y overflow-y-auto px-1 text-[13px]">
          {SHORTCUTS.map(([k, d]) => (
            <div key={k} className="flex items-center justify-between py-2">
              <dt className="text-ink-2">{d}</dt>
              <dd>
                <kbd className="rounded-[6px] border bg-surface px-1.5 py-0.5 font-mono text-[11px]">
                  {k.includes("+") || k === "delete" ? keyLabel(k) : k}
                </kbd>
              </dd>
            </div>
          ))}
        </dl>
      </DialogContent>
    </Dialog>
  );
}
