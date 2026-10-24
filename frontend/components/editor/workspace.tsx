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
import { Toaster } from "@/components/ui/sonner";
import {
  LAYOUT_VERSION,
  SIZES,
  collapsePanel,
  layoutStorage,
  registerPanel,
  togglePanel,
  useLayoutStore,
  type PanelKey,
} from "@/lib/editor/layout";
import { cn } from "@/lib/utils";
import { AssetPanel, AssetRail } from "./assets";
import { EditorDialogs, TopBar } from "./chrome";
import { IconButton, PanelHeaderAction } from "./controls";
import { Inspector } from "./inspector";
import { CommandPalette } from "./palette";
import { Preview } from "./preview";
import { PromptBar } from "./prompt-bar";
import { Timeline } from "./timeline";

/* ---------- Building blocks ---------- */

const PANEL_STYLE = { overflow: "hidden" } as const;

/** Saved layout for one group, plus reset-to-defaults on separator double-click. */
function usePersistentGroup(
  id: string,
  orientation: "horizontal" | "vertical",
  defaults: (groupPx: number) => Record<string, number>,
) {
  const saved = useDefaultLayout({ id: `shortcraft:editor:${LAYOUT_VERSION}:${id}`, storage: layoutStorage });
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

/** A collapsible panel that registers its handle and reports collapse state to the layout store. */
function TrackedPanel({
  name,
  collapsedPx = 0,
  minPx,
  ...props
}: Omit<PanelProps, "panelRef" | "onResize"> & { name: PanelKey; collapsedPx?: number; minPx: number }) {
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
    <main className="flex h-full min-h-0 flex-col bg-surface px-4 pt-4 pb-3 xl:px-6 xl:pt-5">
      <div className="min-h-0 flex-1">
        <Preview />
      </div>
      <div className="mx-auto mt-2 w-full max-w-[560px]">
        <PromptBar />
      </div>
    </main>
  );
}

function AssetsSection({ action }: { action?: ReactNode }) {
  return (
    <PanelHeaderAction.Provider value={action}>
      <AssetPanel />
    </PanelHeaderAction.Provider>
  );
}

function InspectorSection({ action }: { action?: ReactNode }) {
  return (
    <PanelHeaderAction.Provider value={action}>
      <Inspector />
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
          className="group flex h-8 shrink-0 items-center gap-2 border-b px-4 text-left text-xs font-medium text-ink-2 hover:bg-surface/70 focus-visible:bg-surface focus-visible:outline-none"
        >
          Timeline
          <kbd className="font-mono text-[10px] font-normal text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100">\</kbd>
          <span className="ml-auto grid size-6 place-items-center rounded-md text-muted-foreground group-hover:text-ink">
            {collapsed ? <ChevronUp className="size-4" /> : <ChevronDown className="size-4" />}
          </span>
        </button>
      )}
      {!collapsed && (
        <div className="min-h-0 flex-1 overflow-hidden">
          <Timeline />
        </div>
      )}
    </section>
  );
}

/* ---------- ≥1024px: Assets | Player | Inspector over Timeline ---------- */

// 1024–1279px uses the same structure with narrower side panels, so nothing
// moves between breakpoints; the Inspector folds to a 40px strip when hidden.
function ColumnsLayout({ size }: { size: "desktop" | "laptop" }) {
  const collapsed = useLayoutStore((s) => s.collapsed);
  const sz = SIZES[size];
  const rows = usePersistentGroup(`${size}-rows`, "vertical", () => ({ timeline: SIZES.timeline.default }));
  const cols = usePersistentGroup(`${size}-cols`, "horizontal", () => ({ assets: sz.assets.default, inspector: sz.inspector.default }));

  return (
    <Group className="min-h-0 flex-1" {...rows.group}>
      <Panel id="main" minSize={SIZES.main.min} style={PANEL_STYLE}>
        <div className="flex h-full min-h-0">
          <aside className="w-16 shrink-0 border-r bg-surface">
            <AssetRail />
          </aside>
          <Group className="min-w-0 flex-1" {...cols.group}>
            <TrackedPanel name="assets" minPx={sz.assets.min} maxSize={sz.assets.max} defaultSize={sz.assets.default}>
              <div className="h-full bg-white" inert={collapsed.assets}>
                <AssetsSection
                  action={
                    <IconButton label="Hide assets" shortcut="[" onClick={() => collapsePanel("assets")}>
                      <PanelLeftClose className="size-4" />
                    </IconButton>
                  }
                />
              </div>
            </TrackedPanel>
            <Handle onReset={cols.reset} className={cn(collapsed.assets && "hidden")} />
            <Panel id="center" minSize={SIZES.center.min} style={PANEL_STYLE}>
              <Center />
            </Panel>
            <Handle onReset={cols.reset} />
            <TrackedPanel
              name="inspector"
              collapsedPx={sz.inspector.collapsed}
              minPx={sz.inspector.min}
              maxSize={sz.inspector.max}
              defaultSize={sz.inspector.default}
            >
              {collapsed.inspector ? (
                <button
                  onClick={() => togglePanel("inspector")}
                  aria-label="Show inspector"
                  title="Show inspector ( ] )"
                  className="flex h-full w-full flex-col items-center gap-3 bg-white pt-3.5 text-xs font-medium text-ink-2 hover:bg-surface/70 hover:text-ink focus-visible:bg-surface focus-visible:outline-none"
                >
                  <PanelRightOpen className="size-4" />
                  <span className="[writing-mode:vertical-rl]">Inspector</span>
                </button>
              ) : (
                <InspectorSection
                  action={
                    <IconButton label="Hide inspector" shortcut="]" onClick={() => collapsePanel("inspector")}>
                      <PanelRightClose className="size-4" />
                    </IconButton>
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

/* ---------- 768–1023px ---------- */

const TABLET_TABS: { id: PanelKey; label: string }[] = [
  { id: "assets", label: "Assets" },
  { id: "inspector", label: "Inspector" },
  { id: "timeline", label: "Timeline" },
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
          <div className="flex shrink-0 gap-0.5 border-b px-2 py-1.5" role="tablist" aria-label="Editor sections">
            {TABLET_TABS.map((t) => (
              <button
                key={t.id}
                role="tab"
                aria-selected={tabletTab === t.id}
                onClick={() => setTabletTab(t.id)}
                className={cn(
                  "h-8 rounded-[10px] px-3 text-[13px]",
                  tabletTab === t.id ? "bg-surface font-medium text-ink" : "text-ink-2 hover:bg-surface/70 hover:text-ink",
                )}
              >
                {t.label}
              </button>
            ))}
          </div>
          <div className="min-h-0 flex-1">
            {tabletTab === "assets" && (
              <div className="flex h-full min-h-0 flex-col">
                <div className="shrink-0 border-b bg-surface">
                  <AssetRail orientation="horizontal" />
                </div>
                <div className="min-h-0 flex-1">
                  <AssetsSection />
                </div>
              </div>
            )}
            {tabletTab === "inspector" && <InspectorSection />}
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
      {breakpoint === "tablet" ? <TabletLayout /> : <ColumnsLayout key={breakpoint} size={breakpoint} />}
      <CommandPalette />
      <EditorDialogs />
      <Toaster theme="light" position="bottom-center" offset={{ bottom: 24 }} toastOptions={{ classNames: { toast: "!rounded-[12px] !text-[13px]" } }} />
    </div>
  );
}
