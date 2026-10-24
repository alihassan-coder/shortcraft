"use client";

import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import { Highlighter, PencilLine, RotateCcw, Scissors, SmilePlus, X } from "lucide-react";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuShortcut,
  ContextMenuSub,
  ContextMenuSubContent,
  ContextMenuSubTrigger,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import { cutForWord, isCutActive, isWordCut } from "@/lib/edit-plan/timeline";
import { keyLabel } from "@/lib/editor/actions";
import { revealPanel, useBreakpoint } from "@/lib/editor/layout";
import { playerControls } from "@/lib/editor/player";
import { dispatch, usePlanStore, useSelectedId, useTimeline, useUiStore } from "@/lib/editor/store";
import { cn } from "@/lib/utils";
import { PanelHeader } from "./controls";

export const EMOJIS = ["🔥", "👀", "💡", "⏱️", "📱", "🚀", "✅", "❌", "😂", "❤️", "💰", "🎯"];

export function Transcript() {
  const plan = usePlanStore((s) => s.plan);
  const tl = useTimeline();
  const { selectWord, currentMs } = useUiStore();
  const selectedWordId = useSelectedId("word");
  const breakpoint = useBreakpoint();
  // Word under the last right-click; one menu serves the whole transcript.
  const [menuWordId, setMenuWordId] = useState<string | null>(null);
  const menuWord = words.find((w) => w.id === menuWordId);
  // One source per project for now; the transcript follows the first one.
  const source = plan.sources[0];
  const words = source.words;
  const now = tl.toSource(currentMs);
  const selected = words.find((w) => w.id === selectedWordId);
  const scroller = useRef<HTMLDivElement>(null);

  // Pauses that have a silence cut, keyed by the word they follow.
  const pauseAfter = useMemo(() => {
    const map = new Map<string, { ms: number; cut: boolean }>();
    for (const c of plan.cuts.items.filter((c) => c.reason === "silence" && c.sourceId === source.id)) {
      const prev = [...words].reverse().find((w) => w.endMs <= c.startMs + 5);
      if (prev) map.set(prev.id, { ms: c.endMs - c.startMs, cut: isCutActive(plan, c) });
    }
    return map;
  }, [plan, words, source.id]);

  const currentId =
    now && now.sourceId === source.id ? words.find((w) => now.srcMs >= w.startMs && now.srcMs < w.endMs)?.id : undefined;

  useEffect(() => {
    if (!currentId || !useUiStore.getState().playing) return;
    scroller.current?.querySelector(`[data-word="${currentId}"]`)?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [currentId]);

  return (
    <div className="flex h-full min-h-0 flex-col">
      <PanelHeader title="Transcript" description="Click a word to select it, Delete to cut. Right-click for more." />

      {/* On tablets the Inspector is a separate tab, so word actions stay here. */}
      {selected && breakpoint === "tablet" && (
        <WordActions
          key={selected.id}
          text={plan.captions.edits[selected.id] ?? selected.text}
          cut={isWordCut(plan, source.id, selected)}
          highlighted={plan.captions.highlights.includes(selected.id)}
          emoji={plan.captions.emojis[selected.id]}
          onCut={() => dispatch({ type: "toggleWordCut", sourceId: source.id, wordId: selected.id })}
          onHighlight={() => dispatch({ type: "toggleHighlight", wordId: selected.id })}
          onEmoji={(emoji) => dispatch({ type: "setEmoji", wordId: selected.id, emoji })}
          onText={(text) => dispatch({ type: "setWordText", wordId: selected.id, text })}
          onClose={() => selectWord(null)}
        />
      )}

      <ContextMenu onOpenChange={(open) => !open && setMenuWordId(null)}>
      <ContextMenuTrigger asChild>
      <div
        ref={scroller}
        className="min-h-0 flex-1 overflow-y-auto px-4 py-4"
        onContextMenu={(e) => {
          const id = (e.target as HTMLElement).closest<HTMLElement>("[data-word]")?.dataset.word;
          // Only words have a menu; elsewhere the browser's own menu shows.
          if (!id) return e.preventDefault();
          setMenuWordId(id);
          selectWord(id);
        }}
      >
        <p className="text-[15px] leading-[2.05]">
          {words.map((w) => {
            const cut = isWordCut(plan, source.id, w);
            const c = cut ? cutForWord(plan, source.id, w) : undefined;
            const pause = pauseAfter.get(w.id);
            const highlighted = plan.captions.highlights.includes(w.id);
            const emoji = plan.captions.showEmojis ? plan.captions.emojis[w.id] : undefined;
            const current = w.id === currentId && !cut;
            return (
              <Fragment key={w.id}>
                <button
                  data-word={w.id}
                  onClick={() => {
                    selectWord(w.id);
                    playerControls.seekSourceMs(source.id, w.startMs);
                  }}
                  title={c?.note ?? (c ? `Cut: ${c.reason}` : undefined)}
                  style={current ? { background: "var(--ink)", color: "#fff" } : undefined}
                  className={cn(
                    "relative mr-[0.3em] rounded-md px-0.5 transition-colors",
                    cut && "text-cut/80 line-through decoration-cut/50",
                    cut && c?.reason === "retake" && "bg-cut/[0.06]",
                    !cut && highlighted && !current && "bg-caption/45",
                    w.id === selectedWordId && "ring-2 ring-rec ring-offset-1",
                    !cut && !current && "hover:bg-surface",
                  )}
                >
                  {emoji && !cut && <span className="mr-0.5 text-[13px]">{emoji}</span>}
                  {plan.captions.edits[w.id] ?? w.text}
                </button>
                {pause && (
                  <span
                    className={cn(
                      "mr-[0.3em] inline-block rounded px-1 align-middle font-mono text-[10px] leading-4",
                      pause.cut ? "bg-cut/10 text-cut/80 line-through" : "bg-surface text-muted-foreground",
                    )}
                  >
                    {(pause.ms / 1000).toFixed(1)}s
                  </span>
                )}
                {/[.!?]$/.test(w.text) && <span className="block h-2" />}
              </Fragment>
            );
          })}
        </p>
      </div>
      </ContextMenuTrigger>
      {menuWord && (
        <WordMenu
          cut={isWordCut(plan, source.id, menuWord)}
          highlighted={plan.captions.highlights.includes(menuWord.id)}
          emoji={plan.captions.emojis[menuWord.id]}
          onCut={() => dispatch({ type: "toggleWordCut", sourceId: source.id, wordId: menuWord.id })}
          onHighlight={() => dispatch({ type: "toggleHighlight", wordId: menuWord.id })}
          onEmoji={(emoji) => dispatch({ type: "setEmoji", wordId: menuWord.id, emoji })}
          onEdit={() => revealPanel("inspector")}
        />
      )}
      </ContextMenu>
    </div>
  );
}

function WordMenu({
  cut,
  highlighted,
  emoji,
  onCut,
  onHighlight,
  onEmoji,
  onEdit,
}: {
  cut: boolean;
  highlighted: boolean;
  emoji?: string;
  onCut: () => void;
  onHighlight: () => void;
  onEmoji: (e: string | null) => void;
  onEdit: () => void;
}) {
  return (
    <ContextMenuContent className="w-52">
      <ContextMenuItem onSelect={onCut}>
        {cut ? <RotateCcw /> : <Scissors />}
        {cut ? "Restore word" : "Cut word"}
        <ContextMenuShortcut>{keyLabel("delete")}</ContextMenuShortcut>
      </ContextMenuItem>
      <ContextMenuItem onSelect={onHighlight}>
        <Highlighter />
        {highlighted ? "Remove highlight" : "Highlight"}
        <ContextMenuShortcut>H</ContextMenuShortcut>
      </ContextMenuItem>
      <ContextMenuSub>
        <ContextMenuSubTrigger>
          <SmilePlus />
          Add emoji…
        </ContextMenuSubTrigger>
        <ContextMenuSubContent className="w-[184px] p-1.5">
          <div className="grid grid-cols-6 gap-0.5">
            {EMOJIS.map((e) => (
              <ContextMenuItem
                key={e}
                onSelect={() => onEmoji(emoji === e ? null : e)}
                className={cn("grid size-7 place-items-center p-0 text-base", emoji === e && "bg-surface")}
                aria-label={`Emoji ${e}`}
              >
                {e}
              </ContextMenuItem>
            ))}
          </div>
          {emoji && (
            <>
              <ContextMenuSeparator />
              <ContextMenuItem onSelect={() => onEmoji(null)}>
                <X /> Remove emoji
              </ContextMenuItem>
            </>
          )}
        </ContextMenuSubContent>
      </ContextMenuSub>
      <ContextMenuSeparator />
      <ContextMenuItem onSelect={onEdit}>
        <PencilLine />
        Edit spelling…
      </ContextMenuItem>
    </ContextMenuContent>
  );
}

export function WordActions({
  text,
  cut,
  highlighted,
  emoji,
  onCut,
  onHighlight,
  onEmoji,
  onText,
  onClose,
}: {
  text: string;
  cut: boolean;
  highlighted: boolean;
  emoji?: string;
  onCut: () => void;
  onHighlight: () => void;
  onEmoji: (e: string | null) => void;
  onText: (t: string) => void;
  onClose?: () => void;
}) {
  const [draft, setDraft] = useState(text);
  return (
    <div className="space-y-3 border-b bg-surface/60 px-4 py-3.5">
      <div className="flex items-center gap-2">
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={() => onText(draft)}
          onKeyDown={(e) => {
            e.stopPropagation();
            if (e.key === "Enter") (e.target as HTMLInputElement).blur();
          }}
          aria-label="Word text"
          className="h-8 min-w-0 flex-1 rounded-[10px] border bg-white px-2.5 text-[13px] outline-none focus:border-ink"
        />
        {onClose && (
          <button onClick={onClose} className="grid size-8 place-items-center rounded-[10px] text-muted-foreground hover:bg-white" aria-label="Close">
            <X className="size-4" />
          </button>
        )}
      </div>
      <div className="flex gap-1.5">
        <button
          onClick={onHighlight}
          aria-pressed={highlighted}
          className={cn(
            "flex h-8 items-center gap-1.5 rounded-full px-3 text-[13px]",
            highlighted ? "bg-ink text-white" : "border bg-white hover:bg-surface",
          )}
        >
          <Highlighter className="size-3.5" /> Highlight
        </button>
        <button onClick={onCut} className="flex h-8 items-center gap-1.5 rounded-full border bg-white px-3 text-[13px] hover:bg-surface">
          {cut ? <RotateCcw className="size-3.5" /> : <Scissors className="size-3.5" />}
          {cut ? "Restore" : "Cut word"}
        </button>
      </div>
      <div className="flex flex-wrap gap-1">
        {EMOJIS.map((e) => (
          <button
            key={e}
            onClick={() => onEmoji(emoji === e ? null : e)}
            aria-pressed={emoji === e}
            className={cn("grid size-8 place-items-center rounded-lg text-base", emoji === e ? "bg-ink" : "hover:bg-white")}
          >
            {e}
          </button>
        ))}
      </div>
    </div>
  );
}
