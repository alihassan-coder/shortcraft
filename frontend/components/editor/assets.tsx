"use client";

import { Fragment } from "react";
import {
  Aperture,
  ArrowUpRight,
  Blend,
  Captions,
  Check,
  Clapperboard,
  FileText,
  Heading,
  Image as ImageIcon,
  Music2,
  PencilLine,
  Plus,
  ScissorsLineDashed,
  Shapes,
  Smile,
  Square,
  Trash2,
  Type,
  Upload,
  ZoomIn,
  Copy,
  type LucideIcon,
} from "lucide-react";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuShortcut,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { CAPTION_PRESETS, captionTextStyle } from "@/lib/caption-presets";
import type { Clip, TextOverlay } from "@/lib/edit-plan/schema";
import { formatTime } from "@/lib/edit-plan/timeline";
import { addTextAtPlayhead, applyColorPreset, duplicateText, keyLabel, targetClip } from "@/lib/editor/actions";
import { revealPanel } from "@/lib/editor/layout";
import { playerControls } from "@/lib/editor/player";
import { dispatch, usePlanStore, useSelectedId, useUiStore, type AssetTab } from "@/lib/editor/store";
import { cn } from "@/lib/utils";
import { clipFilter } from "@/remotion/short-video";
import { Group, PanelHeader, SoonTile, ToggleRow } from "./controls";
import { AudioPanel, CaptionsPanel, CutsPanel, HookPanel, ZoomPanel } from "./panels";
import { Transcript } from "./transcript";

/* ---------- Tabs ---------- */

type TabDef = { id: AssetTab; label: string; icon: LucideIcon };

// Grouped: your footage, the edits the agents make, then creative extras.
const TAB_GROUPS: TabDef[][] = [
  [
    { id: "media", label: "Media", icon: Clapperboard },
    { id: "transcript", label: "Transcript", icon: FileText },
  ],
  [
    { id: "captions", label: "Captions", icon: Captions },
    { id: "cuts", label: "Cuts", icon: ScissorsLineDashed },
    { id: "zoom", label: "Zoom", icon: ZoomIn },
    { id: "hook", label: "Hook", icon: Heading },
  ],
  [
    { id: "text", label: "Text", icon: Type },
    { id: "audio", label: "Audio", icon: Music2 },
    { id: "elements", label: "Elements", icon: Shapes },
    { id: "filters", label: "Filters", icon: Aperture },
    { id: "transitions", label: "Transitions", icon: Blend },
  ],
];

export const ASSET_TABS = TAB_GROUPS.flat();
/** Number keys 1–9 and 0 switch to the first ten tabs. */
export const TAB_KEYS: Record<string, AssetTab> = Object.fromEntries(
  ASSET_TABS.slice(0, 10).map((t, i) => [String((i + 1) % 10), t.id]),
);
const keyFor = (id: AssetTab) => Object.entries(TAB_KEYS).find(([, t]) => t === id)?.[0];

export function openTab(tab: AssetTab) {
  useUiStore.getState().setTab(tab);
  revealPanel("assets");
}

export function AssetRail({ orientation = "vertical" }: { orientation?: "vertical" | "horizontal" }) {
  const tab = useUiStore((s) => s.tab);
  const horizontal = orientation === "horizontal";
  return (
    <nav
      aria-label="Assets"
      className={cn(
        "flex",
        horizontal ? "items-center gap-0.5 overflow-x-auto px-2 py-1.5 [scrollbar-width:none]" : "h-full flex-col items-center overflow-y-auto py-2 [scrollbar-width:none]",
      )}
    >
      {TAB_GROUPS.map((group, gi) => (
        <Fragment key={gi}>
          {gi > 0 && <span aria-hidden className={cn("shrink-0 bg-line", horizontal ? "mx-1 h-5 w-px" : "my-1.5 h-px w-8")} />}
          {group.map(({ id, label, icon: Icon }) => {
            const key = keyFor(id);
            return (
              <Tooltip key={id}>
                <TooltipTrigger asChild>
                  <button
                    onClick={() => openTab(id)}
                    aria-pressed={tab === id}
                    data-tab={id}
                    className={cn(
                      "flex shrink-0 items-center rounded-[10px] transition-colors focus-visible:ring-2 focus-visible:ring-rec/40 focus-visible:outline-none",
                      horizontal ? "h-8 gap-1.5 px-2.5 text-[13px]" : "my-px w-[56px] flex-col gap-[3px] py-[7px] text-[10.5px] leading-none",
                      tab === id ? "bg-white text-ink shadow-[0_0_0_1px_var(--border)]" : "text-ink-2 hover:bg-white/70 hover:text-ink",
                    )}
                  >
                    <Icon className={horizontal ? "size-4" : "size-[18px]"} strokeWidth={tab === id ? 2 : 1.75} />
                    {label}
                  </button>
                </TooltipTrigger>
                <TooltipContent side={horizontal ? "bottom" : "right"}>
                  {label}
                  {key && <kbd className="ml-1 font-mono opacity-60">{key}</kbd>}
                </TooltipContent>
              </Tooltip>
            );
          })}
        </Fragment>
      ))}
    </nav>
  );
}

const PANELS: Record<AssetTab, () => React.JSX.Element> = {
  media: MediaPanel,
  transcript: Transcript,
  text: TextPanel,
  captions: CaptionsPanel,
  audio: AudioPanel,
  elements: ElementsPanel,
  filters: FiltersPanel,
  transitions: TransitionsPanel,
  cuts: CutsPanel,
  zoom: ZoomPanel,
  hook: HookPanel,
};

export function AssetPanel() {
  const tab = useUiStore((s) => s.tab);
  const Panel = PANELS[tab];
  // The transcript manages its own scrolling (sticky word bar + scroller).
  return tab === "transcript" ? (
    <div className="h-full min-h-0">
      <Panel />
    </div>
  ) : (
    <div className="h-full overflow-y-auto">
      <Panel />
    </div>
  );
}

/* ---------- Media ---------- */

function MediaPanel() {
  const plan = usePlanStore((s) => s.plan);
  return (
    <>
      <PanelHeader title="Media" description="Footage, images and audio in this project." />
      <Group>
        <Tooltip>
          <TooltipTrigger asChild>
            {/* Disabled buttons swallow hover, so the tooltip sits on a wrapper. */}
            <span tabIndex={0} className="block rounded-[10px] outline-none focus-visible:ring-2 focus-visible:ring-rec/40">
              <button
                disabled
                className="flex h-8 w-full items-center justify-center gap-1.5 rounded-[10px] border text-[13px] text-ink-2 disabled:opacity-50"
              >
                <Upload className="size-4" /> Upload media
              </button>
            </span>
          </TooltipTrigger>
          <TooltipContent>Uploads arrive with cloud storage</TooltipContent>
        </Tooltip>
      </Group>
      <Group label="In this project">
        <div className="grid grid-cols-2 gap-2">
          {plan.sources.map((src) => {
            const used = plan.clips.some((c) => c.sourceId === src.id);
            const name = decodeURIComponent(src.src.split("/").pop() ?? "Video");
            return (
              <button
                key={src.id}
                onClick={() => playerControls.seekSourceMs(src.id, 0)}
                className="group text-left"
                data-media={src.id}
              >
                <span className="relative block aspect-[9/16] overflow-hidden rounded-[10px] bg-surface ring-1 ring-line transition group-hover:ring-ink/30">
                  {src.poster && (
                    // eslint-disable-next-line @next/next/no-img-element -- local poster frame, sized by CSS
                    <img src={src.poster} alt="" className="absolute inset-0 size-full object-cover" />
                  )}
                  <span className="absolute right-1.5 bottom-1.5 rounded-[5px] bg-black/65 px-1.5 py-0.5 font-mono text-[10px] text-white">
                    {formatTime(src.durationMs)}
                  </span>
                  {used && (
                    <span className="absolute top-1.5 left-1.5 flex items-center gap-1 rounded-[5px] bg-white/95 px-1.5 py-0.5 text-[10px] font-medium text-ink">
                      <Check className="size-2.5" strokeWidth={3} /> In use
                    </span>
                  )}
                </span>
                <span className="mt-1.5 block truncate text-xs text-ink">{name}</span>
                <span className="block text-[11px] text-muted-foreground">
                  {src.width}×{src.height} · {src.words.length} words
                </span>
              </button>
            );
          })}
        </div>
      </Group>
    </>
  );
}

/* ---------- Text ---------- */

const TEXT_SAMPLES: Record<string, string> = { "bold-pop": "BIG NEWS", clean: "Clean title", karaoke: "Sing along" };

function TextPanel() {
  const texts = usePlanStore((s) => s.plan.overlays.texts);
  const selectedId = useSelectedId("text");
  return (
    <>
      <PanelHeader title="Text" description="Adds a title at the playhead." />
      <Group>
        <button
          onClick={() => addTextAtPlayhead()}
          className="flex h-8 w-full items-center justify-center gap-1.5 rounded-[10px] bg-ink text-[13px] font-medium text-white hover:bg-ink-2"
        >
          <Plus className="size-4" /> Add text
        </button>
      </Group>
      <Group label="Styles">
        <div className="grid grid-cols-2 gap-2">
          {CAPTION_PRESETS.map((p) => (
            <button
              key={p.id}
              onClick={() => addTextAtPlayhead(p.id, TEXT_SAMPLES[p.id] ?? p.name)}
              className="group rounded-[12px] p-1 text-left ring-1 ring-transparent transition hover:ring-line"
              aria-label={`Add ${p.name} text`}
            >
              <span className="grid h-16 place-items-center overflow-hidden rounded-[9px] bg-[#2a2a2e] px-2 text-[15px]">
                <span style={captionTextStyle(p, false)} className="truncate">
                  {TEXT_SAMPLES[p.id] ?? p.name}
                </span>
              </span>
              <span className="mt-1 flex items-center justify-between px-1 text-xs text-ink-2">
                {p.name}
                <Plus className="size-3.5 opacity-0 transition group-hover:opacity-100" />
              </span>
            </button>
          ))}
        </div>
      </Group>
      <Group label={`In this video (${texts.length})`}>
        {texts.length ? (
          <ul className="-mx-2 space-y-0.5">
            {texts.map((t) => (
              <TextItem key={t.id} text={t} selected={t.id === selectedId} />
            ))}
          </ul>
        ) : (
          <p className="text-xs text-muted-foreground">No text yet. Pick a style above.</p>
        )}
      </Group>
    </>
  );
}

function TextItem({ text, selected }: { text: TextOverlay; selected: boolean }) {
  const edit = () => {
    useUiStore.getState().select({ kind: "text", id: text.id });
    revealPanel("inspector");
    playerControls.seekOutputMs(text.startMs);
  };
  return (
    <li>
      <TextContextMenu textId={text.id} onEdit={edit}>
        <button
          onClick={edit}
          data-text-item={text.id}
          className={cn("flex w-full items-center gap-2.5 rounded-[10px] px-2 py-1.5 text-left", selected ? "bg-surface" : "hover:bg-surface")}
        >
          <span className="grid size-7 place-items-center rounded-[8px] bg-white ring-1 ring-line">
            <Type className="size-3.5" />
          </span>
          <span className="min-w-0 flex-1 truncate text-[13px]">{text.text || "Empty text"}</span>
          <span className="font-mono text-[11px] text-muted-foreground">{formatTime(text.startMs, true)}</span>
        </button>
      </TextContextMenu>
    </li>
  );
}

/** Right-click menu for a text item (assets list and timeline). */
export function TextContextMenu({ textId, onEdit, children }: { textId: string; onEdit: () => void; children: React.ReactNode }) {
  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>{children}</ContextMenuTrigger>
      <ContextMenuContent className="w-48">
        <ContextMenuItem onSelect={onEdit}>
          <PencilLine /> Edit
        </ContextMenuItem>
        <ContextMenuItem onSelect={() => duplicateText(textId)}>
          <Copy /> Duplicate
        </ContextMenuItem>
        <ContextMenuSeparator />
        <ContextMenuItem
          variant="destructive"
          onSelect={() => {
            dispatch({ type: "removeText", textId });
            const ui = useUiStore.getState();
            if (ui.selection?.id === textId) ui.select(null);
          }}
        >
          <Trash2 /> Delete
          <ContextMenuShortcut>{keyLabel("delete")}</ContextMenuShortcut>
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  );
}

/* ---------- Elements ---------- */

function ElementsPanel() {
  const bar = usePlanStore((s) => s.plan.overlays.progressBar);
  return (
    <>
      <PanelHeader title="Elements" description="Extras that sit on top of your video." />
      <Group>
        <div className="rounded-[12px] border p-3">
          <div className="mb-2 h-10 overflow-hidden rounded-[8px] bg-[#2a2a2e]">
            <div className="h-1.5 w-2/5" style={{ background: bar.color }} />
          </div>
          <ToggleRow
            label="Progress bar"
            hint="Shows viewers how much is left"
            checked={bar.enabled}
            onChange={(enabled) => dispatch({ type: "setProgressBar", bar: { enabled } })}
          />
        </div>
      </Group>
      <Group label="Stickers and shapes">
        <div className="grid grid-cols-2 gap-2">
          <SoonTile label="Emoji">
            <Smile className="size-5" strokeWidth={1.5} />
          </SoonTile>
          <SoonTile label="Shapes">
            <Square className="size-5" strokeWidth={1.5} />
          </SoonTile>
          <SoonTile label="Arrows">
            <ArrowUpRight className="size-5" strokeWidth={1.5} />
          </SoonTile>
          <SoonTile label="Logo">
            <ImageIcon className="size-5" strokeWidth={1.5} />
          </SoonTile>
        </div>
      </Group>
    </>
  );
}

/* ---------- Transitions ---------- */

const TRANSITIONS: { label: string; draw: React.ReactNode }[] = [
  {
    label: "Fade",
    draw: (
      <>
        <rect x="4" y="6" width="32" height="20" rx="3" className="fill-ink/15" />
        <rect x="15" y="6" width="21" height="20" rx="3" className="fill-ink/25" />
        <rect x="26" y="6" width="10" height="20" rx="3" className="fill-ink/50" />
      </>
    ),
  },
  {
    label: "Slide",
    draw: (
      <>
        <rect x="4" y="6" width="18" height="20" rx="3" className="fill-ink/25" />
        <rect x="18" y="6" width="18" height="20" rx="3" className="fill-ink/60" />
      </>
    ),
  },
  {
    label: "Wipe",
    draw: (
      <>
        <rect x="4" y="6" width="32" height="20" rx="3" className="fill-ink/20" />
        <path d="M4 26 L24 6 H33 a3 3 0 0 1 3 3 V23 a3 3 0 0 1-3 3Z" className="fill-ink/60" />
      </>
    ),
  },
  {
    label: "Zoom",
    draw: (
      <>
        <rect x="4" y="6" width="32" height="20" rx="3" className="fill-ink/20" />
        <rect x="13" y="11" width="14" height="10" rx="2" className="fill-ink/60" />
      </>
    ),
  },
  {
    label: "Whip",
    draw: (
      <>
        <rect x="4" y="6" width="32" height="20" rx="3" className="fill-ink/20" />
        <path d="M8 12h18M12 16h20M8 20h16" className="stroke-ink/60" strokeWidth="2" strokeLinecap="round" />
      </>
    ),
  },
];

function TransitionsPanel() {
  return (
    <>
      <PanelHeader title="Transitions" description="Smooth changes between clips. Split a clip to make room for one." />
      <Group>
        <div className="grid grid-cols-2 gap-2">
          {TRANSITIONS.map((t) => (
            <SoonTile key={t.label} label={t.label}>
              <svg viewBox="0 0 40 32" className="h-9 w-12" aria-hidden>
                {t.draw}
              </svg>
            </SoonTile>
          ))}
        </div>
      </Group>
    </>
  );
}

/* ---------- Filters ---------- */

const FILTERS: { value: Clip["color"]["preset"]; label: string }[] = [
  { value: "none", label: "Original" },
  { value: "natural", label: "Natural" },
  { value: "warm", label: "Warm" },
  { value: "cool", label: "Cool" },
  { value: "vivid", label: "Vivid" },
  { value: "mono", label: "Mono" },
  { value: "film", label: "Film" },
];

const NEUTRAL = { brightness: 0, contrast: 0, saturation: 0, temperature: 0 };

function FiltersPanel() {
  const plan = usePlanStore((s) => s.plan);
  // Re-render when the selection or playhead changes which clip is the target.
  useUiStore((s) => s.selection);
  useUiStore((s) => s.currentMs);
  const clip = targetClip(plan);
  const index = plan.clips.findIndex((c) => c.id === clip.id);
  const poster = plan.sources.find((s) => s.id === clip.sourceId)?.poster;
  const selected = useSelectedId("clip") === clip.id;

  return (
    <>
      <PanelHeader title="Filters" description="A color look for one clip or all of them." />
      <Group>
        <p className="mb-2.5 text-xs text-muted-foreground">
          Applies to <span className="text-ink">Clip {index + 1}</span>
          {selected ? " (selected)" : plan.clips.length > 1 ? " (at the playhead)" : ""}
        </p>
        <div className="grid grid-cols-3 gap-2">
          {FILTERS.map((f) => {
            const active = clip.color.preset === f.value;
            return (
              <button key={f.value} onClick={() => applyColorPreset(f.value)} aria-pressed={active} className="group text-left" data-filter={f.value}>
                <span
                  className={cn(
                    "relative block aspect-[4/5] overflow-hidden rounded-[10px] bg-surface ring-2 ring-offset-1 transition",
                    active ? "ring-ink" : "ring-transparent group-hover:ring-line",
                  )}
                >
                  {poster && (
                    // eslint-disable-next-line @next/next/no-img-element -- tiny local thumbnail
                    <img
                      src={poster}
                      alt=""
                      className="absolute inset-0 size-full object-cover"
                      style={{ filter: clipFilter({ ...clip, color: { preset: f.value, ...NEUTRAL } }) }}
                    />
                  )}
                </span>
                <span className="mt-1 block text-center text-xs text-ink-2">{f.label}</span>
              </button>
            );
          })}
        </div>
        {plan.clips.length > 1 && (
          <button
            onClick={() => applyColorPreset(clip.color.preset, true)}
            className="mt-3 flex h-8 w-full items-center justify-center rounded-[10px] border text-[13px] hover:bg-surface"
          >
            Use this look on all clips
          </button>
        )}
      </Group>
    </>
  );
}
