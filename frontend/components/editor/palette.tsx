"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Sparkles } from "lucide-react";
import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandShortcut,
} from "@/components/ui/command";
import { CAPTION_PRESETS } from "@/lib/caption-presets";
import type { Aspect } from "@/lib/edit-plan/schema";
import {
  addTextAtPlayhead,
  askAgents,
  comingSoon,
  deleteSelection,
  duplicateClip,
  focusTitle,
  keyLabel,
  splitAtPlayhead,
  toggleOriginal,
} from "@/lib/editor/actions";
import { togglePanel } from "@/lib/editor/layout";
import { PROMPT_SUGGESTIONS } from "@/lib/editor/mock-director";
import { dispatch, redo, undo, useUiStore } from "@/lib/editor/store";
import { ASSET_TABS, openTab } from "./assets";

type Item = { id: string; label: string; keywords?: string[]; shortcut?: string; run: () => void };

const ASPECTS: [Aspect, string][] = [
  ["9:16", "Vertical"],
  ["1:1", "Square"],
  ["4:5", "Portrait"],
  ["16:9", "Landscape"],
];

export function CommandPalette() {
  const open = useUiStore((s) => s.dialog === "palette");
  const setDialog = useUiStore((s) => s.setDialog);
  const router = useRouter();
  const [query, setQuery] = useState("");

  const groups: { heading: string; items: Item[] }[] = [
    {
      heading: "Edit",
      items: [
        { id: "split", label: "Split at playhead", shortcut: "S", keywords: ["cut", "razor"], run: splitAtPlayhead },
        { id: "duplicate", label: "Duplicate clip", shortcut: "mod+D", run: () => duplicateClip() },
        { id: "delete", label: "Delete selection", shortcut: "delete", keywords: ["remove"], run: deleteSelection },
        { id: "add-text", label: "Add text at playhead", keywords: ["title"], run: () => addTextAtPlayhead() },
        { id: "undo", label: "Undo", shortcut: "mod+Z", run: undo },
        { id: "redo", label: "Redo", shortcut: "mod+shift+Z", run: redo },
      ],
    },
    {
      heading: "Canvas",
      items: ASPECTS.map(([a, name]) => ({
        id: `aspect-${a}`,
        label: `Set aspect ratio ${a}`,
        keywords: [name, "canvas", "size", "resize"],
        run: () => dispatch({ type: "setCanvas", canvas: { aspect: a } }),
      })),
    },
    {
      heading: "Caption style",
      items: CAPTION_PRESETS.map((p) => ({
        id: `caption-${p.id}`,
        label: `Caption style: ${p.name}`,
        keywords: [p.description, "captions", "subtitles"],
        run: () => dispatch({ type: "setCaptions", captions: { presetId: p.id } }),
      })),
    },
    {
      heading: "Go to",
      items: ASSET_TABS.map((t) => ({ id: `tab-${t.id}`, label: `Open ${t.label}`, keywords: ["tab", "panel"], run: () => openTab(t.id) })),
    },
    {
      heading: "View",
      items: [
        { id: "toggle-assets", label: "Show / hide assets", shortcut: "[", run: () => togglePanel("assets") },
        { id: "toggle-inspector", label: "Show / hide inspector", shortcut: "]", run: () => togglePanel("inspector") },
        { id: "toggle-timeline", label: "Show / hide timeline", shortcut: "\\", run: () => togglePanel("timeline") },
        { id: "safe-zones", label: "Toggle safe zones", run: () => useUiStore.getState().setSafeZones(!useUiStore.getState().safeZones) },
        { id: "original", label: "Show original / edited", shortcut: "O", run: toggleOriginal },
        { id: "zoom-fit", label: "Preview zoom: fit", run: () => useUiStore.getState().setPreviewZoom("fit") },
        { id: "zoom-100", label: "Preview zoom: 100%", run: () => useUiStore.getState().setPreviewZoom(1) },
      ],
    },
    {
      heading: "Project",
      items: [
        { id: "rename", label: "Rename project", run: () => setTimeout(focusTitle, 0) },
        { id: "export", label: "Export…", shortcut: "mod+E", run: () => useUiStore.getState().setDialog("export") },
        { id: "duplicate-project", label: "Duplicate project", run: () => comingSoon("Duplicating projects") },
        { id: "shortcuts", label: "Keyboard shortcuts", shortcut: "?", run: () => useUiStore.getState().setDialog("shortcuts") },
        { id: "back", label: "Back to projects", run: () => router.push("/") },
      ],
    },
  ];

  const run = (fn: () => void, keepDialog = false) => {
    if (!keepDialog) setDialog(null);
    setQuery("");
    fn();
  };

  const ask = query.trim();

  return (
    <CommandDialog
      open={open}
      onOpenChange={(o) => {
        setDialog(o ? "palette" : null);
        if (!o) setQuery("");
      }}
      title="Command palette"
      description="Search editor actions or ask the agents for a change"
      className="top-[18%] sm:max-w-[560px]"
    >
      <CommandInput value={query} onValueChange={setQuery} placeholder="Search actions, or describe a change…" />
      <CommandList className="max-h-[min(420px,60vh)] p-1">
        {!ask && <CommandEmpty>No matching action.</CommandEmpty>}
        {!ask && (
          <CommandGroup heading="Try asking">
            {PROMPT_SUGGESTIONS.slice(0, 3).map((s) => (
              <CommandItem key={s} value={`ask ${s}`} onSelect={() => run(() => askAgents(s))}>
                <Sparkles className="text-muted-foreground" />
                {s}
              </CommandItem>
            ))}
          </CommandGroup>
        )}
        {groups.map((g) => (
          <CommandGroup key={g.heading} heading={g.heading}>
            {g.items.map((it) => (
              <CommandItem key={it.id} value={it.label} keywords={it.keywords} onSelect={() => run(it.run)} data-command={it.id}>
                {it.label}
                {it.shortcut && (
                  <CommandShortcut className="font-mono text-[11px] tracking-normal">
                    {it.shortcut.includes("+") || it.shortcut === "delete" ? keyLabel(it.shortcut) : it.shortcut}
                  </CommandShortcut>
                )}
              </CommandItem>
            ))}
          </CommandGroup>
        ))}
        {ask && (
          <CommandGroup heading="Agents" forceMount>
            <CommandItem value="__ask-agents" forceMount onSelect={() => run(() => askAgents(ask))} data-ask>
              <Sparkles className="text-rec" />
              <span className="truncate">
                Ask the agents: <span className="text-ink">“{ask}”</span>
              </span>
            </CommandItem>
          </CommandGroup>
        )}
      </CommandList>
    </CommandDialog>
  );
}
