"use client";

import { createContext, useContext, useRef, useState } from "react";
import { ChevronRight } from "lucide-react";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { keyLabel } from "@/lib/editor/actions";
import { cn } from "@/lib/utils";

/** Extra control shown at the right of every panel header (the layout puts its collapse button here). */
export const PanelHeaderAction = createContext<React.ReactNode>(null);

export function PanelHeader({ title, description }: { title: string; description?: string }) {
  const action = useContext(PanelHeaderAction);
  return (
    <div className="flex min-h-11 items-start gap-2 border-b px-4 py-2.5">
      <div className="min-w-0 flex-1 pt-0.5">
        <h2 className="text-[13px] leading-5 font-semibold">{title}</h2>
        {description && <p className="mt-0.5 text-xs leading-snug text-muted-foreground">{description}</p>}
      </div>
      {action && <div className="-mr-1.5 shrink-0">{action}</div>}
    </div>
  );
}

export function Group({ label, children, className }: { label?: string; children: React.ReactNode; className?: string }) {
  return (
    <div className={cn("border-b px-4 py-3.5 last:border-b-0", className)}>
      {label && <p className="mb-2.5 text-xs font-medium text-muted-foreground">{label}</p>}
      {children}
    </div>
  );
}

// Open/closed state of inspector sections survives switching selection.
const openSections = new Map<string, boolean>();

/** Collapsible inspector group. */
export function Section({
  id,
  title,
  children,
  defaultOpen = true,
  aside,
}: {
  id: string;
  title: string;
  children: React.ReactNode;
  defaultOpen?: boolean;
  aside?: React.ReactNode;
}) {
  const [open, setOpen] = useState(() => openSections.get(id) ?? defaultOpen);
  return (
    <section className="border-b last:border-b-0">
      <div className="flex h-10 items-center pr-3">
        <button
          onClick={() => {
            openSections.set(id, !open);
            setOpen(!open);
          }}
          aria-expanded={open}
          className="flex h-full flex-1 items-center gap-1.5 pl-3 text-left text-[13px] font-medium text-ink outline-none focus-visible:bg-surface"
        >
          <ChevronRight className={cn("size-3.5 text-muted-foreground transition-transform duration-150", open && "rotate-90")} />
          {title}
        </button>
        {aside}
      </div>
      {open && <div className="space-y-3 px-4 pb-4">{children}</div>}
    </section>
  );
}

/** Label on the left, control on the right. */
export function Row({ label, children, className }: { label: string; children: React.ReactNode; className?: string }) {
  return (
    <div className={cn("flex min-h-8 items-center justify-between gap-3", className)}>
      <span className="shrink-0 text-[13px] text-ink-2">{label}</span>
      {children}
    </div>
  );
}

export function ToggleRow({
  label,
  hint,
  checked,
  onChange,
}: {
  label: string;
  hint?: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <label className="flex cursor-pointer items-center justify-between gap-4 py-1.5">
      <span>
        <span className="block text-[13px]">{label}</span>
        {hint && <span className="block text-xs text-muted-foreground">{hint}</span>}
      </span>
      <Switch checked={checked} onCheckedChange={onChange} aria-label={label} />
    </label>
  );
}

export function SliderRow({
  label,
  value,
  min,
  max,
  step = 1,
  format = (v) => String(v),
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  format?: (v: number) => string;
  onChange: (v: number) => void;
}) {
  return (
    <div className="py-1">
      <div className="mb-2 flex items-center justify-between text-[13px]">
        <span className="text-ink-2">{label}</span>
        <span className="font-mono text-xs text-muted-foreground tabular-nums">{format(value)}</span>
      </div>
      <Slider value={[value]} min={min} max={max} step={step} onValueChange={([v]) => onChange(v)} aria-label={label} />
    </div>
  );
}

export function Segmented<T extends string | number>({
  value,
  options,
  onChange,
  className,
  label,
}: {
  value: T | null;
  options: { value: T; label: React.ReactNode; title?: string }[];
  onChange: (v: T) => void;
  className?: string;
  label?: string;
}) {
  return (
    <div
      role="group"
      aria-label={label}
      className={cn("grid auto-cols-fr grid-flow-col gap-0.5 rounded-[10px] bg-surface p-0.5 text-[13px]", className)}
    >
      {options.map((o) => (
        <button
          key={String(o.value)}
          onClick={() => onChange(o.value)}
          aria-pressed={o.value === value}
          title={o.title}
          className={cn(
            "flex h-7 items-center justify-center gap-1 rounded-[8px] px-2 transition-colors",
            o.value === value ? "bg-white font-medium text-ink shadow-[0_0_0_1px_var(--border)]" : "text-muted-foreground hover:text-ink",
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

/** Numeric input that commits on blur / Enter, so typing "1" on the way to "1000" does nothing. */
export function NumberField({
  label,
  value,
  onCommit,
  min,
  max,
  step = 1,
  suffix,
  className,
}: {
  label: string;
  value: number;
  onCommit: (v: number) => void;
  min?: number;
  max?: number;
  step?: number;
  suffix?: string;
  className?: string;
}) {
  const [draft, setDraft] = useState(String(value));
  const [shown, setShown] = useState(value);
  // Escape blurs the input, and blur commits; this flag makes that blur a no-op.
  const cancelled = useRef(false);
  if (shown !== value) {
    setShown(value);
    setDraft(String(value));
  }
  const commit = () => {
    if (cancelled.current) {
      cancelled.current = false;
      return;
    }
    const n = Number(draft);
    if (!Number.isFinite(n) || draft.trim() === "") return setDraft(String(value));
    const clamped = Math.min(max ?? Infinity, Math.max(min ?? -Infinity, n));
    if (clamped !== value) onCommit(clamped);
    setDraft(String(clamped));
  };
  return (
    <label
      className={cn(
        "flex h-8 items-center gap-1.5 rounded-[10px] border bg-white px-2.5 text-[13px] focus-within:border-ink",
        className,
      )}
    >
      <span className="text-xs text-muted-foreground">{label}</span>
      <input
        inputMode="decimal"
        value={draft}
        step={step}
        aria-label={label}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          e.stopPropagation();
          if (e.key === "Enter") (e.target as HTMLInputElement).blur();
          if (e.key === "Escape") {
            cancelled.current = true;
            setDraft(String(value));
            (e.target as HTMLInputElement).blur();
          }
        }}
        className="w-full min-w-0 bg-transparent text-right font-mono text-xs tabular-nums outline-none"
      />
      {suffix && <span className="text-xs text-muted-foreground">{suffix}</span>}
    </label>
  );
}

/** 32px icon button with a tooltip that shows its shortcut. */
export function IconButton({
  label,
  shortcut,
  onClick,
  disabled,
  pressed,
  side,
  className,
  children,
}: {
  label: string;
  shortcut?: string;
  onClick?: () => void;
  disabled?: boolean;
  pressed?: boolean;
  side?: "top" | "bottom" | "left" | "right";
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          onClick={onClick}
          disabled={disabled}
          aria-label={label}
          aria-pressed={pressed}
          className={cn(
            "grid size-8 shrink-0 place-items-center rounded-[10px] text-ink-2 transition-colors hover:bg-surface hover:text-ink focus-visible:ring-2 focus-visible:ring-rec/40 focus-visible:outline-none disabled:opacity-35 disabled:hover:bg-transparent",
            pressed && "bg-surface text-ink",
            className,
          )}
        >
          {children}
        </button>
      </TooltipTrigger>
      <TooltipContent side={side}>
        {label}
        {shortcut && <Kbd>{keyLabel(shortcut)}</Kbd>}
      </TooltipContent>
    </Tooltip>
  );
}

export function Kbd({ children, className }: { children: React.ReactNode; className?: string }) {
  return <kbd className={cn("font-mono text-[11px] opacity-60", className)}>{children}</kbd>;
}

/** A tile in an assets grid that is not built yet. */
export function SoonTile({ label, children }: { label: string; children?: React.ReactNode }) {
  return (
    <div aria-disabled className="cursor-not-allowed rounded-[12px] border border-dashed p-1.5 text-left">
      <div className="grid h-16 place-items-center rounded-[8px] bg-surface text-muted-foreground/70">{children}</div>
      <div className="mt-1.5 flex items-center justify-between px-0.5">
        <span className="text-xs text-ink-2">{label}</span>
        <span className="text-[10px] text-muted-foreground">Soon</span>
      </div>
    </div>
  );
}
