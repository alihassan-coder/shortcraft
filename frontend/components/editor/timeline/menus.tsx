"use client";

import { useState } from "react";
import {
  ClipboardPaste,
  Copy,
  Eye,
  EyeOff,
  Gauge,
  Lock,
  LockOpen,
  Paintbrush,
  PencilLine,
  Plus,
  Scissors,
  Trash2,
  Volume2,
  VolumeX,
} from "lucide-react";
import {
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuRadioGroup,
  ContextMenuRadioItem,
  ContextMenuSeparator,
  ContextMenuShortcut,
  ContextMenuSub,
  ContextMenuSubContent,
  ContextMenuSubTrigger,
} from "@/components/ui/context-menu";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Slider } from "@/components/ui/slider";
import { TRACK_NAMES, type Track, type TrackKind, type Transition, type TransitionType } from "@/lib/edit-plan/schema";
import {
  copySelection,
  copyStyle,
  copyTextStyle,
  deleteSelection,
  duplicateSelection,
  findItem,
  keyLabel,
  pasteAtPlayhead,
  pasteStyle,
  pasteTextStyle,
  setClipSpeed,
  splitSelectionAtPlayhead,
} from "@/lib/editor/actions";
import { revealPanel } from "@/lib/editor/layout";
import { dispatch, usePlanStore, useUiStore } from "@/lib/editor/store";
import { useTimelineView } from "@/lib/editor/timeline-view";
import { cn } from "@/lib/utils";
import { KIND_ICON } from "./model";

export const SPEEDS = [0.25, 0.5, 0.75, 1, 1.25, 1.5, 2, 3, 4];

/* ---------- transitions ---------- */

const TRANSITIONS: { value: TransitionType; label: string }[] = [
  { value: "none", label: "None" },
  { value: "fade", label: "Fade" },
  { value: "slide", label: "Slide" },
  { value: "wipe", label: "Wipe" },
  { value: "zoom", label: "Zoom" },
  { value: "whip", label: "Whip" },
];

/** Diamond on the cut between two clips; opens the transition picker. */
export function TransitionButton({
  clipId,
  nextClipId,
  transition,
  x,
}: {
  clipId: string;
  nextClipId: string;
  transition?: Transition;
  x: number;
}) {
  const [open, setOpen] = useState(false);
  const active = !!transition && transition.type !== "none";
  const type = transition?.type ?? "none";
  const duration = transition?.durationMs ?? 400;
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          data-tl-transition={clipId}
          aria-label={active ? `Transition: ${type}` : "Add transition"}
          title={active ? `${type} · ${(duration / 1000).toFixed(1)}s` : "Add transition"}
          className="group/tr absolute z-[7] grid size-5 -translate-x-1/2 place-items-center"
          // On the top edge of the clips, so it never covers the trim handles.
          style={{ left: x, top: -7 }}
        >
          <span
            className={cn(
              "size-[9px] rotate-45 rounded-[2px] border transition-transform group-hover/tr:scale-125",
              active ? "border-white bg-ink shadow-[0_0_0_1px_var(--ink)]" : "border-ink/50 bg-white",
              open && "border-white bg-rec shadow-[0_0_0_1px_var(--rec)]",
            )}
          />
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-64 rounded-[12px] p-3" side="top" data-transition-popover={nextClipId}>
        <p className="mb-2 text-xs font-medium text-ink">Transition</p>
        <div className="grid grid-cols-3 gap-1" role="group" aria-label="Transition type">
          {TRANSITIONS.map((t) => (
            <button
              key={t.value}
              type="button"
              aria-pressed={type === t.value}
              onClick={() => dispatch({ type: "setTransition", clipId, transition: t.value === "none" ? null : { type: t.value } })}
              className={cn(
                "h-7 rounded-[8px] border text-xs",
                type === t.value ? "border-ink bg-ink text-white" : "border-line text-ink-2 hover:border-ink/30 hover:text-ink",
              )}
            >
              {t.label}
            </button>
          ))}
        </div>
        <div className={cn("mt-3", !active && "pointer-events-none opacity-40")}>
          <div className="mb-2 flex items-center justify-between text-xs">
            <span className="text-ink-2">Duration</span>
            <span className="font-mono text-muted-foreground tabular-nums">{(duration / 1000).toFixed(2)}s</span>
          </div>
          <Slider
            aria-label="Transition duration"
            value={[duration]}
            min={100}
            max={2000}
            step={50}
            onValueChange={([v]) => dispatch({ type: "setTransition", clipId, transition: { durationMs: v } })}
          />
        </div>
      </PopoverContent>
    </Popover>
  );
}

/* ---------- add track ---------- */

const KINDS: TrackKind[] = ["text", "element", "image", "sfx"];

export function AddTrackButton() {
  const [open, setOpen] = useState(false);
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label="Add track"
          className="flex h-7 items-center gap-1.5 rounded-[8px] px-2 text-xs text-ink-2 hover:bg-surface hover:text-ink"
        >
          <Plus className="size-3.5" /> Add track
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-44 rounded-[12px] p-1">
        {KINDS.map((k) => {
          const Icon = KIND_ICON[k];
          return (
            <button
              key={k}
              type="button"
              onClick={() => {
                dispatch({ type: "addTrack", kind: k });
                setOpen(false);
              }}
              className="flex h-8 w-full items-center gap-2 rounded-[8px] px-2 text-[13px] hover:bg-surface"
            >
              <Icon className="size-3.5 text-ink-2" /> {TRACK_NAMES[k]}
            </button>
          );
        })}
      </PopoverContent>
    </Popover>
  );
}

/* ---------- context menu ---------- */

export type MenuTarget =
  | { type: "clip"; id: string }
  | { type: "item"; id: string }
  | { type: "zoom"; id: string }
  | { type: "track"; id: string }
  | { type: "lane"; ms: number };

function Key({ k }: { k: string }) {
  return <ContextMenuShortcut className="font-mono text-[11px] tracking-normal">{k.length > 1 ? keyLabel(k) : k}</ContextMenuShortcut>;
}

function SpeedSub() {
  const plan = usePlanStore((s) => s.plan);
  const selected = useUiStore((s) => s.selected);
  const clip = plan.clips.find((c) => selected.some((s) => s.kind === "clip" && s.id === c.id));
  return (
    <ContextMenuSub>
      <ContextMenuSubTrigger>
        <Gauge /> Speed
      </ContextMenuSubTrigger>
      <ContextMenuSubContent className="w-32">
        <ContextMenuRadioGroup value={String(clip?.speed ?? "")} onValueChange={(v) => setClipSpeed(Number(v))}>
          {SPEEDS.map((s) => (
            <ContextMenuRadioItem key={s} value={String(s)}>
              {s}×
            </ContextMenuRadioItem>
          ))}
        </ContextMenuRadioGroup>
      </ContextMenuSubContent>
    </ContextMenuSub>
  );
}

function TrackItems({ track, onRename }: { track: Track; onRename: () => void }) {
  const update = (patch: Partial<Pick<Track, "locked" | "hidden" | "muted">>) => dispatch({ type: "updateTrack", trackId: track.id, patch });
  return (
    <>
      <ContextMenuItem onSelect={onRename}>
        <PencilLine /> Rename track
      </ContextMenuItem>
      <ContextMenuItem onSelect={() => update({ locked: !track.locked })}>
        {track.locked ? <LockOpen /> : <Lock />} {track.locked ? "Unlock track" : "Lock track"}
      </ContextMenuItem>
      {track.kind === "sfx" ? (
        <ContextMenuItem onSelect={() => update({ muted: !track.muted })}>
          {track.muted ? <Volume2 /> : <VolumeX />} {track.muted ? "Unmute track" : "Mute track"}
        </ContextMenuItem>
      ) : (
        <ContextMenuItem onSelect={() => update({ hidden: !track.hidden })}>
          {track.hidden ? <Eye /> : <EyeOff />} {track.hidden ? "Show track" : "Hide track"}
        </ContextMenuItem>
      )}
    </>
  );
}

export function TimelineMenu({ target, onRename }: { target: MenuTarget | null; onRename: (trackId: string) => void }) {
  const plan = usePlanStore((s) => s.plan);
  const selected = useUiStore((s) => s.selected);
  const hasClipStyle = useUiStore((s) => !!s.styleClipboard);
  const { clipboard, textStyle } = useTimelineView();
  const n = selected.length;
  const many = n > 1 ? ` ${n} items` : "";

  if (!target) return <ContextMenuContent className="hidden" />;

  const common = (
    <>
      <ContextMenuItem onSelect={splitSelectionAtPlayhead}>
        <Scissors /> Split at playhead
        <Key k="S" />
      </ContextMenuItem>
      <ContextMenuItem onSelect={duplicateSelection}>
        <Copy /> Duplicate{many}
        <Key k="mod+D" />
      </ContextMenuItem>
    </>
  );
  const del = (
    <ContextMenuItem variant="destructive" onSelect={() => deleteSelection()}>
      <Trash2 /> Delete{many}
      <Key k="delete" />
    </ContextMenuItem>
  );

  if (target.type === "clip") {
    return (
      <ContextMenuContent className="w-56" data-tl-menu="clip">
        {common}
        <SpeedSub />
        <ContextMenuSeparator />
        <ContextMenuItem onSelect={() => copyStyle(target.id)}>
          <Paintbrush /> Copy style
        </ContextMenuItem>
        <ContextMenuItem disabled={!hasClipStyle} onSelect={() => pasteStyle(target.id)}>
          <ClipboardPaste /> Paste style
        </ContextMenuItem>
        <ContextMenuItem onSelect={() => revealPanel("inspector")}>
          <PencilLine /> Edit in inspector
        </ContextMenuItem>
        <ContextMenuSeparator />
        {del}
      </ContextMenuContent>
    );
  }

  if (target.type === "item") {
    const hit = findItem(target.id, plan);
    const isText = hit?.item.kind === "text";
    const textIds = selected.filter((s) => s.kind === "text").map((s) => s.id);
    return (
      <ContextMenuContent className="w-56" data-tl-menu="item">
        {common}
        <ContextMenuItem onSelect={copySelection}>
          <Copy /> Copy{many}
          <Key k="mod+C" />
        </ContextMenuItem>
        <ContextMenuItem disabled={!clipboard?.length} onSelect={pasteAtPlayhead}>
          <ClipboardPaste /> Paste at playhead
          <Key k="mod+V" />
        </ContextMenuItem>
        {isText && (
          <>
            <ContextMenuSeparator />
            <ContextMenuItem onSelect={() => copyTextStyle(target.id)}>
              <Paintbrush /> Copy style
            </ContextMenuItem>
            <ContextMenuItem disabled={!textStyle} onSelect={() => pasteTextStyle(textIds.length ? textIds : [target.id])}>
              <ClipboardPaste /> Paste style
            </ContextMenuItem>
          </>
        )}
        {hit && (
          <>
            <ContextMenuSeparator />
            <TrackItems track={hit.track} onRename={() => onRename(hit.track.id)} />
          </>
        )}
        <ContextMenuSeparator />
        {del}
        <ContextMenuItem variant="destructive" onSelect={() => deleteSelection({ ripple: true })}>
          <Trash2 /> Ripple delete
          <Key k="shift+delete" />
        </ContextMenuItem>
      </ContextMenuContent>
    );
  }

  if (target.type === "zoom") {
    return (
      <ContextMenuContent className="w-48" data-tl-menu="zoom">
        <ContextMenuItem onSelect={() => revealPanel("inspector")}>
          <PencilLine /> Edit
        </ContextMenuItem>
        <ContextMenuSeparator />
        {del}
      </ContextMenuContent>
    );
  }

  if (target.type === "track") {
    const track = plan.tracks.find((t) => t.id === target.id);
    if (!track) return <ContextMenuContent className="hidden" />;
    return (
      <ContextMenuContent className="w-52" data-tl-menu="track">
        <TrackItems track={track} onRename={() => onRename(track.id)} />
        <ContextMenuSeparator />
        <ContextMenuItem
          variant="destructive"
          disabled={track.locked}
          onSelect={() => dispatch({ type: "removeTrack", trackId: track.id })}
        >
          <Trash2 /> Delete track
        </ContextMenuItem>
      </ContextMenuContent>
    );
  }

  return (
    <ContextMenuContent className="w-52" data-tl-menu="lane">
      <ContextMenuItem disabled={!clipboard?.length} onSelect={pasteAtPlayhead}>
        <ClipboardPaste /> Paste at playhead
        <Key k="mod+V" />
      </ContextMenuItem>
      <ContextMenuItem onSelect={splitSelectionAtPlayhead}>
        <Scissors /> Split at playhead
        <Key k="S" />
      </ContextMenuItem>
      <ContextMenuSeparator />
      <ContextMenuSub>
        <ContextMenuSubTrigger>
          <Plus /> Add track
        </ContextMenuSubTrigger>
        <ContextMenuSubContent className="w-44">
          {KINDS.map((k) => {
            const Icon = KIND_ICON[k];
            return (
              <ContextMenuItem key={k} onSelect={() => dispatch({ type: "addTrack", kind: k })}>
                <Icon /> {TRACK_NAMES[k]}
              </ContextMenuItem>
            );
          })}
        </ContextMenuSubContent>
      </ContextMenuSub>
    </ContextMenuContent>
  );
}
