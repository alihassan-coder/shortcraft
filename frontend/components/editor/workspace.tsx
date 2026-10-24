"use client";

import { useEffect, useRef, type ReactNode } from "react";
import {
  Group,
  Panel,
  Separator,
  useDefaultLayout,
  useGroupRef,
  usePanelRef,
  type GroupImperativeHandle,
  type PanelImperativeHandle,
  type PanelProps,
  type PanelSize,
} from "react-resizable-panels";
import { ChevronDown, ChevronUp, PanelLeftClose, PanelRightClose, PanelRightOpen } from "lucide-react";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import {
  SIZES,
  collapsePanel,
  layoutStorage,
  registerPanel,
  togglePanel,
  useLayoutStore,
  type PanelKey,
} from "@/lib/editor/layout";
import { cn } from "@/lib/utils";
import { ToolRail, TopBar } from "./chrome";
import { PanelHeaderAction } from "./controls";
import { ToolPanel } from "./panels";
import { Preview } from "./preview";
import { PromptBar } from "./prompt-bar";
import { Timeline } from "./timeline";
import { Transcript } from "./transcript";

/* ---------- Building blocks ---------- */

const PANEL_STYLE = { overflow: "hidden" } as const;

/** Saved layout for one group, plus reset-to-defaults on separator double-click. */
function usePersistentGroup(
  id: string,
  orientation: "horizontal" | "vertical",
  defaults: (groupPx: number) => Record<string, number>,
) {
  const saved = useDefaultLayout({ id: `shortcraft:editor:${id}`, storage: layoutStorage });
  const groupRef = useGroupRef();
  const elementRef = useRef<HTMLDivElement>(null);
  const reset = () => resetGroup(groupRef.current, elementRef.current, orientation, defaults);
  return {
    group: {
      id,
      orientation,
      defaultLayout: saved.defaultLayout,
      onLayoutChanged: saved.onLayoutChanged,
      groupRef,
      elementRef,
      // The library defaults to 100% × 100%; these groups are flex children instead.
      style: orientation === "vertical" ? { height: "auto" } : { width: "auto" },
    },
    reset,
  };
}

function resetGroup(
  group: GroupImperativeHandle | null,
  el: HTMLElement | null,
  orientation: "horizontal" | "vertical",
  defaults: (groupPx: number) => Record<string, number>,
) {
  if (!group || !el) return;
  const px = orientation === "vertical" ? el.clientHeight : el.clientWidth;
  if (px <= 0) return;
  const pxLayout = defaults(px);
  const fixed = Object.values(pxLayout).reduce((a, b) => a + b, 0);
  const layout: Record<string, number> = {};
  for (const [k, v] of Object.entries(pxLayout)) layout[k] = (v / px) * 100;
  // The one panel left out of `defaults` takes the remaining space.
  const rest = Object.keys(group.getLayout()).find((k) => !(k in pxLayout));
  if (rest) layout[rest] = Math.max(0, 100 - (fixed / px) * 100);
  group.setLayout(layout);
}

/** Brand separator: 1px hairline, ~10px hit area (set by the library), 2px accent line while hovered or dragged. */
function Handle({ onReset, className }: { onReset: () => void; className?: string }) {
  return (
    <Separator
      disableDoubleClick
      onDoubleClick={onReset}
      title="Drag to resize. Double-click to reset."
      className={cn(
        "group/handle relative shrink-0 bg-line outline-none",
        "aria-[orientation=vertical]:w-px aria-[orientation=horizontal]:h-px",
        // Accent line, centred on the hairline.
        "after:pointer-events-none after:absolute after:z-20 after:bg-transparent after:transition-colors after:duration-100",
        "aria-[orientation=vertical]:after:inset-y-0 aria-[orientation=vertical]:after:left-1/2 aria-[orientation=vertical]:after:w-0.5 aria-[orientation=vertical]:after:-translate-x-1/2",
        "aria-[orientation=horizontal]:after:inset-x-0 aria-[orientation=horizontal]:after:top-1/2 aria-[orientation=horizontal]:after:h-0.5 aria-[orientation=horizontal]:after:-translate-y-1/2",
        "data-[separator=hover]:after:bg-ink/60 data-[separator=active]:after:bg-rec data-[separator=focus]:after:bg-rec",
        className,
      )}
    />
  );
}

function IconToggle({ label, shortcut, onClick, children }: { label: string; shortcut?: string; onClick: () => void; children: ReactNode }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          onClick={onClick}
          aria-label={label}
          className="grid size-8 place-items-center rounded-lg text-muted-foreground hover:bg-surface hover:text-ink focus-visible:ring-2 focus-visible:ring-rec/40 focus-visible:outline-none"
        >
          {children}
        </button>
      </TooltipTrigger>
      <TooltipContent>
        {label}
        {shortcut && <kbd className="ml-1.5 font-mono opacity-60">{shortcut}</kbd>}
      </TooltipContent>
    </Tooltip>
  );
}

/** A collapsible panel that registers its handle and reports collapse state to the layout store. */
function TrackedPanel({
  name,
  collapsedPx = 0,
  minPx,
  ...props
}: Omit<PanelProps, "panelRef" | "onResize"> & { name: PanelKey | "side"; collapsedPx?: number; minPx: number }) {
  const ref = usePanelRef();
  const setCollapsed = useLayoutStore((s) => s.setCollapsed);
  useEffect(() => registerPanel(name, ref), [name, ref]);
  const onResize = (size: PanelSize) => setCollapsed(name, size.inPixels < (collapsedPx + minPx) / 2);
  return (
    <Panel
      id={name}
      panelRef={ref as React.RefObject<PanelImperativeHandle | null>}
      collapsible
      collapsedSize={collapsedPx}
      minSize={minPx}
      onResize={onResize}
      style={PANEL_STYLE}
      {...props}
    />
  );
}

function Center() {
  return (
    <main className="flex h-full min-h-0 flex-col bg-surface/50 px-5 pt-5 pb-4 xl:px-8 xl:pt-6 xl:pb-5">
      <div className="min-h-0 flex-1">
        <Preview />
      </div>
      <div className="mx-auto mt-4 w-full max-w-[720px]">
        <PromptBar />
      </div>
    </main>
  );
}

function ToolsSection({ action }: { action?: ReactNode }) {
  return (
    <PanelHeaderAction.Provider value={action}>
      <div className="h-full overflow-y-auto">
        <ToolPanel />
      </div>
    </PanelHeaderAction.Provider>
  );
}

function TranscriptSection({ action }: { action?: ReactNode }) {
  return (
    <PanelHeaderAction.Provider value={action}>
      <div className="h-full min-h-0">
        <Transcript />
      </div>
    </PanelHeaderAction.Provider>
  );
}

/** Timeline with a slim header. Collapsed, only the header is left (32px), so it doubles as the expand bar. */
function TimelineSection({ collapsible = true }: { collapsible?: boolean }) {
  const collapsed = useLayoutStore((s) => s.collapsed.timeline) && collapsible;
  return (
    <section className="flex h-full min-h-0 flex-col bg-white">
      {collapsible && (
        <button
          onClick={() => togglePanel("timeline")}
          aria-expanded={!collapsed}
          aria-label={collapsed ? "Show timeline" : "Hide timeline"}
          className="group flex h-8 shrink-0 items-center gap-2 px-5 text-left text-xs font-medium text-ink-2 hover:bg-surface/70 focus-visible:bg-surface focus-visible:outline-none"
        >
          Timeline
          <kbd className="font-mono text-[10px] font-normal text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100">\</kbd>
          <span className="ml-auto grid size-6 place-items-center rounded-md text-muted-foreground group-hover:text-ink">
            {collapsed ? <ChevronUp className="size-4" /> : <ChevronDown className="size-4" />}
          </span>
        </button>
      )}
      {!collapsed && (
        <div className="min-h-0 flex-1 overflow-auto">
          <Timeline />
        </div>
      )}
    </section>
  );
}

/* ---------- ≥1280px ---------- */

function DesktopLayout() {
  const collapsed = useLayoutStore((s) => s.collapsed);
  const rows = usePersistentGroup("desktop-rows", "vertical", () => ({ timeline: SIZES.timeline.default }));
  const cols = usePersistentGroup("desktop-cols", "horizontal", () => ({ tools: SIZES.tools.default, transcript: SIZES.transcript.default }));

  return (
    <Group className="min-h-0 flex-1" {...rows.group}>
      <Panel id="main" minSize={SIZES.main.min} style={PANEL_STYLE}>
        <div className="flex h-full min-h-0">
          <aside className={cn("w-20 shrink-0 bg-surface", !collapsed.tools && "border-r")}>
            <ToolRail />
          </aside>
          <Group className="min-w-0 flex-1" {...cols.group}>
            <TrackedPanel
              name="tools"
              minPx={SIZES.tools.min}
              maxSize={SIZES.tools.max}
              defaultSize={SIZES.tools.default}
            >
              <div className="h-full" inert={collapsed.tools}>
                <ToolsSection
                  action={
                    <IconToggle label="Hide tool panel" shortcut="[" onClick={() => collapsePanel("tools")}>
                      <PanelLeftClose className="size-4" />
                    </IconToggle>
                  }
                />
              </div>
            </TrackedPanel>
            <Handle onReset={cols.reset} />
            <Panel id="center" minSize={SIZES.center.min} style={PANEL_STYLE}>
              <Center />
            </Panel>
            <Handle onReset={cols.reset} />
            <TrackedPanel
              name="transcript"
              collapsedPx={SIZES.transcript.collapsed}
              minPx={SIZES.transcript.min}
              maxSize={SIZES.transcript.max}
              defaultSize={SIZES.transcript.default}
            >
              {collapsed.transcript ? (
                <button
                  onClick={() => togglePanel("transcript")}
                  aria-label="Show transcript"
                  title="Show transcript ( ] )"
                  className="flex h-full w-full flex-col items-center gap-3 bg-white pt-4 text-xs font-medium text-ink-2 hover:bg-surface/70 hover:text-ink focus-visible:bg-surface focus-visible:outline-none"
                >
                  <PanelRightOpen className="size-4" />
                  <span className="[writing-mode:vertical-rl]">Transcript</span>
                </button>
              ) : (
                <TranscriptSection
                  action={
                    <IconToggle label="Hide transcript" shortcut="]" onClick={() => collapsePanel("transcript")}>
                      <PanelRightClose className="size-4" />
                    </IconToggle>
                  }
                />
              )}
            </TrackedPanel>
          </Group>
        </div>
      </Panel>
      <Handle onReset={rows.reset} />
      <TrackedPanel
        name="timeline"
        collapsedPx={SIZES.timeline.collapsed}
        minPx={SIZES.timeline.min}
        maxSize={SIZES.timeline.max}
        defaultSize={SIZES.timeline.default}
      >
        <TimelineSection />
      </TrackedPanel>
    </Group>
  );
}

/* ---------- 1024–1279px ---------- */

function SideSwitch() {
  const { sideTab, setSideTab } = useLayoutStore();
  return (
    <div className="flex items-center gap-2 border-b px-3 py-2.5">
      <div className="inline-flex flex-1 rounded-full bg-surface p-0.5 text-[13px]" role="tablist" aria-label="Left panel">
        {(
          [
            ["tools", "Tools", "["],
            ["transcript", "Transcript", "]"],
          ] as const
        ).map(([id, label]) => (
          <button
            key={id}
            role="tab"
            aria-selected={sideTab === id}
            onClick={() => setSideTab(id)}
            className={cn(
              "h-8 flex-1 rounded-full",
              sideTab === id ? "bg-white font-medium text-ink shadow-sm" : "text-muted-foreground hover:text-ink",
            )}
          >
            {label}
          </button>
        ))}
      </div>
      <IconToggle label="Hide panel" onClick={() => collapsePanel("side")}>
        <PanelLeftClose className="size-4" />
      </IconToggle>
    </div>
  );
}

function LaptopLayout() {
  const collapsed = useLayoutStore((s) => s.collapsed.side);
  const sideTab = useLayoutStore((s) => s.sideTab);
  const rows = usePersistentGroup("laptop-rows", "vertical", () => ({ timeline: SIZES.timeline.default }));
  const cols = usePersistentGroup("laptop-cols", "horizontal", () => ({ side: SIZES.side.default }));

  return (
    <Group className="min-h-0 flex-1" {...rows.group}>
      <Panel id="main" minSize={SIZES.main.min} style={PANEL_STYLE}>
        <div className="flex h-full min-h-0">
          <aside className={cn("w-20 shrink-0 bg-surface", !collapsed && "border-r")}>
            <ToolRail />
          </aside>
          <Group className="min-w-0 flex-1" {...cols.group}>
            <TrackedPanel name="side" minPx={SIZES.side.min} maxSize={SIZES.side.max} defaultSize={SIZES.side.default}>
              <div className="flex h-full min-h-0 flex-col" inert={collapsed}>
                <SideSwitch />
                <div className="min-h-0 flex-1">{sideTab === "tools" ? <ToolsSection /> : <TranscriptSection />}</div>
              </div>
            </TrackedPanel>
            <Handle onReset={cols.reset} />
            <Panel id="center" minSize={SIZES.center.min} style={PANEL_STYLE}>
              <Center />
            </Panel>
          </Group>
        </div>
      </Panel>
      <Handle onReset={rows.reset} />
      <TrackedPanel
        name="timeline"
        collapsedPx={SIZES.timeline.collapsed}
        minPx={SIZES.timeline.min}
        maxSize={SIZES.timeline.max}
        defaultSize={SIZES.timeline.default}
      >
        <TimelineSection />
      </TrackedPanel>
    </Group>
  );
}

/* ---------- 768–1023px ---------- */

const TABLET_TABS: { id: PanelKey; label: string; key: string }[] = [
  { id: "tools", label: "Tools", key: "[" },
  { id: "transcript", label: "Transcript", key: "]" },
  { id: "timeline", label: "Timeline", key: "\\" },
];

function TabletLayout() {
  const { tabletTab, setTabletTab } = useLayoutStore();
  const rows = usePersistentGroup("tablet-rows", "vertical", (px) => ({ preview: Math.round(px * 0.55) }));

  return (
    <Group className="min-h-0 flex-1" {...rows.group}>
      <Panel id="preview" defaultSize="55%" minSize={280} style={PANEL_STYLE}>
        <Center />
      </Panel>
      <Handle onReset={rows.reset} />
      <Panel id="sections" minSize={220} style={PANEL_STYLE}>
        <div className="flex h-full min-h-0 flex-col bg-white">
          <div className="flex shrink-0 gap-1 border-b px-3 py-2" role="tablist" aria-label="Editor sections">
            {TABLET_TABS.map((t) => (
              <button
                key={t.id}
                role="tab"
                aria-selected={tabletTab === t.id}
                onClick={() => setTabletTab(t.id)}
                className={cn(
                  "h-9 rounded-full px-4 text-sm",
                  tabletTab === t.id ? "bg-ink font-medium text-white" : "text-ink-2 hover:bg-surface hover:text-ink",
                )}
              >
                {t.label}
              </button>
            ))}
          </div>
          <div className="min-h-0 flex-1">
            {tabletTab === "tools" && (
              <div className="flex h-full min-h-0 flex-col">
                <div className="shrink-0 border-b bg-surface">
                  <ToolRail orientation="horizontal" />
                </div>
                <div className="min-h-0 flex-1">
                  <ToolsSection />
                </div>
              </div>
            )}
            {tabletTab === "transcript" && <TranscriptSection />}
            {tabletTab === "timeline" && <TimelineSection collapsible={false} />}
          </div>
        </div>
      </Panel>
    </Group>
  );
}

/* ---------- Shell ---------- */

export function Workspace({ breakpoint }: { breakpoint: "desktop" | "laptop" | "tablet" }) {
  return (
    <div className="flex h-dvh flex-col overflow-hidden bg-white">
      <TopBar />
      {breakpoint === "desktop" && <DesktopLayout />}
      {breakpoint === "laptop" && <LaptopLayout />}
      {breakpoint === "tablet" && <TabletLayout />}
    </div>
  );
}
