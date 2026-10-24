"use client";

import { useState } from "react";
import Link from "next/link";
import { useStore } from "zustand";
import {
  Captions,
  ChevronLeft,
  Download,
  Keyboard,
  Music2,
  Palette,
  Redo2,
  ScissorsLineDashed,
  Type,
  Undo2,
  ZoomIn,
  type LucideIcon,
} from "lucide-react";
import { LogoMark } from "@/components/brand/logo";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { formatTime } from "@/lib/edit-plan/timeline";
import { revealPanel } from "@/lib/editor/layout";
import { dispatch, redo, undo, usePlanStore, useTimeline, useUiStore, type Tool } from "@/lib/editor/store";
import { cn } from "@/lib/utils";

const TOOLS: { id: Tool; label: string; icon: LucideIcon; key: string }[] = [
  { id: "style", label: "Style", icon: Palette, key: "1" },
  { id: "captions", label: "Captions", icon: Captions, key: "2" },
  { id: "cuts", label: "Cuts", icon: ScissorsLineDashed, key: "3" },
  { id: "zoom", label: "Zoom", icon: ZoomIn, key: "4" },
  { id: "music", label: "Audio", icon: Music2, key: "5" },
  { id: "hook", label: "Hook", icon: Type, key: "6" },
];

export const TOOL_KEYS = Object.fromEntries(TOOLS.map((t) => [t.key, t.id])) as Record<string, Tool>;

export function ToolRail({ orientation = "vertical" }: { orientation?: "vertical" | "horizontal" }) {
  const { tool, setTool } = useUiStore();
  const horizontal = orientation === "horizontal";
  return (
    <nav
      className={cn(
        "flex gap-1",
        horizontal ? "overflow-x-auto px-3 py-2 [scrollbar-width:none]" : "flex-col items-center py-3",
      )}
      aria-label="Tools"
    >
      {TOOLS.map(({ id, label, icon: Icon, key }) => (
        <Tooltip key={id}>
          <TooltipTrigger asChild>
            <button
              onClick={() => {
                setTool(id);
                // Picking a tool (or the active one again) always brings its panel back.
                revealPanel("tools");
              }}
              aria-pressed={tool === id}
              className={cn(
                "flex shrink-0 items-center rounded-xl text-[11px] transition-colors",
                horizontal ? "h-9 gap-1.5 px-3 text-[13px]" : "w-16 flex-col gap-1 py-2.5",
                tool === id ? "bg-white text-ink shadow-sm" : "text-ink-2 hover:bg-white/60 hover:text-ink",
              )}
            >
              <Icon className={horizontal ? "size-4" : "size-[18px]"} strokeWidth={1.75} />
              {label}
            </button>
          </TooltipTrigger>
          <TooltipContent side={horizontal ? "bottom" : "right"}>
            {label} <kbd className="ml-1 font-mono opacity-60">{key}</kbd>
          </TooltipContent>
        </Tooltip>
      ))}
    </nav>
  );
}

export function TopBar() {
  const plan = usePlanStore((s) => s.plan);
  const canUndo = useStore(usePlanStore.temporal, (s) => s.pastStates.length > 0);
  const canRedo = useStore(usePlanStore.temporal, (s) => s.futureStates.length > 0);
  const [exportOpen, setExportOpen] = useState(false);
  const [keysOpen, setKeysOpen] = useState(false);
  const outMs = useTimeline({ original: false }).durationMs;
  const { width, height } = plan.canvas;

  return (
    <header className="flex h-14 items-center gap-3 border-b bg-white px-3">
      <Link href="/" className="grid size-9 place-items-center rounded-lg hover:bg-surface" aria-label="Back to home">
        <LogoMark className="h-5 w-3.5" />
      </Link>
      <Link href="/" className="hidden items-center text-sm text-muted-foreground hover:text-ink sm:flex">
        <ChevronLeft className="size-4" /> Projects
      </Link>
      <span className="text-line">/</span>
      <input
        value={plan.title}
        onChange={(e) => dispatch({ type: "setTitle", title: e.target.value })}
        onKeyDown={(e) => e.stopPropagation()}
        aria-label="Project name"
        className="h-8 w-[min(340px,30vw)] truncate rounded-lg px-2 text-sm font-medium outline-none hover:bg-surface focus:bg-surface"
      />
      <span className="hidden items-center gap-1.5 text-xs text-muted-foreground md:flex">
        <span className="size-1.5 rounded-full bg-emerald-500" /> Saved
      </span>

      <div className="ml-auto flex items-center gap-1">
        <IconButton label="Undo (Ctrl+Z)" disabled={!canUndo} onClick={undo}>
          <Undo2 className="size-4" />
        </IconButton>
        <IconButton label="Redo (Ctrl+Shift+Z)" disabled={!canRedo} onClick={redo}>
          <Redo2 className="size-4" />
        </IconButton>
        <IconButton label="Keyboard shortcuts" onClick={() => setKeysOpen(true)}>
          <Keyboard className="size-4" />
        </IconButton>
        <span className="mx-2 hidden font-mono text-xs text-muted-foreground lg:inline">
          {formatTime(outMs, true)} · {width}×{height}
        </span>
        <button
          onClick={() => setExportOpen(true)}
          className="flex h-9 items-center gap-2 rounded-full bg-ink px-4 text-sm font-medium text-white hover:bg-ink-2"
        >
          <Download className="size-4" /> Export
        </button>
      </div>

      <ExportDialog open={exportOpen} onOpenChange={setExportOpen} />
      <ShortcutsDialog open={keysOpen} onOpenChange={setKeysOpen} />
    </header>
  );
}

function IconButton({
  label,
  disabled,
  onClick,
  children,
}: {
  label: string;
  disabled?: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          onClick={onClick}
          disabled={disabled}
          aria-label={label}
          className="grid size-9 place-items-center rounded-lg text-ink-2 hover:bg-surface hover:text-ink disabled:opacity-35 disabled:hover:bg-transparent"
        >
          {children}
        </button>
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  );
}

const PRESETS = [
  { id: "tiktok", label: "TikTok", note: "1080×1920 · 30fps" },
  { id: "reels", label: "Instagram Reels", note: "1080×1920 · 30fps" },
  { id: "shorts", label: "YouTube Shorts", note: "1080×1920 · 30fps" },
];

function ExportDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (v: boolean) => void }) {
  const [preset, setPreset] = useState("tiktok");
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="rounded-[24px] p-7 sm:max-w-[440px]">
        <DialogTitle className="text-xl font-semibold">Export video</DialogTitle>
        <DialogDescription>Choose where you&apos;ll post it. We size and frame it for you.</DialogDescription>
        <div className="mt-2 space-y-2">
          {PRESETS.map((p) => (
            <button
              key={p.id}
              onClick={() => setPreset(p.id)}
              className={cn(
                "flex w-full items-center justify-between rounded-2xl border px-4 py-3.5 text-left",
                preset === p.id ? "border-ink" : "hover:bg-surface",
              )}
            >
              <span className="text-[15px] font-medium">{p.label}</span>
              <span className="font-mono text-xs text-muted-foreground">{p.note}</span>
            </button>
          ))}
        </div>
        <div className="mt-2 rounded-2xl bg-surface p-4 text-sm text-ink-2">
          Rendering runs on our servers and arrives with the backend (Part 5). Your edit is saved and ready.
        </div>
        <button disabled className="mt-1 h-11 w-full rounded-full bg-ink text-[15px] font-medium text-white opacity-40">
          Export MP4
        </button>
      </DialogContent>
    </Dialog>
  );
}

const SHORTCUTS = [
  ["Space", "Play / pause"],
  ["J / L", "Back / forward 1 second"],
  ["K", "Pause"],
  ["← / →", "Previous / next word"],
  ["Delete", "Cut or restore selected word"],
  ["H", "Highlight selected word"],
  ["1 – 6", "Switch tool"],
  ["[", "Show / hide tool panel"],
  ["]", "Show / hide transcript"],
  ["\\", "Show / hide timeline"],
  ["Ctrl + Z", "Undo"],
  ["Ctrl + Shift + Z", "Redo"],
];

function ShortcutsDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (v: boolean) => void }) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="rounded-[24px] p-7 sm:max-w-[420px]">
        <DialogTitle className="text-xl font-semibold">Keyboard shortcuts</DialogTitle>
        <DialogDescription className="sr-only">All editor shortcuts</DialogDescription>
        <dl className="mt-2 divide-y text-sm">
          {SHORTCUTS.map(([k, d]) => (
            <div key={k} className="flex justify-between py-2.5">
              <dt className="text-ink-2">{d}</dt>
              <dd>
                <kbd className="rounded-md border bg-surface px-2 py-0.5 font-mono text-xs">{k}</kbd>
              </dd>
            </div>
          ))}
        </dl>
      </DialogContent>
    </Dialog>
  );
}
