import { Captions, Music2, ScissorsLineDashed, ZoomIn } from "lucide-react";
import { ButtonLink, Container } from "@/components/site/layout-primitives";
import { clipById } from "@/lib/demo-clips";
import { BeforeAfter } from "./before-after";

const TRANSCRIPT: { w: string; cut?: boolean }[] = [
  { w: "Stop" }, { w: "posting" }, { w: "like" }, { w: "this." }, { w: "um", cut: true }, { w: "If" },
  { w: "your" }, { w: "video" }, { w: "starts" }, { w: "slow—", cut: true }, { w: "if", cut: true },
  { w: "your", cut: true }, { w: "video", cut: true }, { w: "starts" }, { w: "slow," }, { w: "people" },
  { w: "scroll." }, { w: "[1.6s]", cut: true }, { w: "This" }, { w: "one" }, { w: "trick" }, { w: "saved" },
  { w: "me" }, { w: "ten" }, { w: "hours" }, { w: "every" }, { w: "single" }, { w: "week." },
];

const APPLIED = [
  { icon: ScissorsLineDashed, label: "Pauses & retakes", value: "14 cut" },
  { icon: Captions, label: "Captions", value: "Bold Pop" },
  { icon: ZoomIn, label: "Zoom-ins", value: "4" },
  { icon: Music2, label: "Music", value: "Morning Run" },
];

function ProductFrame() {
  return (
    <div className="overflow-hidden rounded-[28px] bg-white shadow-frame">
      {/* Window bar */}
      <div className="flex items-center gap-3 border-b px-5 py-3">
        <span className="flex gap-1.5" aria-hidden>
          <span className="size-3 rounded-full bg-[#ff5f57]" />
          <span className="size-3 rounded-full bg-[#febc2e]" />
          <span className="size-3 rounded-full bg-[#28c840]" />
        </span>
        <span className="text-sm font-medium">morning-tip.mov</span>
        <span className="hidden items-center gap-1.5 text-xs text-muted-foreground sm:flex">
          <span className="size-1.5 rounded-full bg-rec" /> Saved
        </span>
        <span className="ml-auto rounded-full bg-ink px-3.5 py-1.5 text-xs font-medium text-white">Export</span>
      </div>

      <div className="grid md:grid-cols-[1fr_minmax(0,360px)_1fr]">
        {/* Transcript */}
        <div className="hidden border-r p-6 md:block">
          <p className="text-xs font-medium text-muted-foreground">Transcript</p>
          <p className="mt-4 text-[15px] leading-8 text-ink-2">
            {TRANSCRIPT.map((t, i) => (
              <span
                key={i}
                className={
                  t.cut
                    ? "mr-1 rounded bg-cut/10 px-0.5 text-cut line-through decoration-cut/60"
                    : "mr-1"
                }
              >
                {t.w}
              </span>
            ))}
          </p>
        </div>

        {/* Preview */}
        <div className="bg-surface px-6 py-8 sm:px-10">
          <BeforeAfter clip={clipById("42323")} className="mx-auto max-w-[290px]" />
          <p className="mt-4 text-center text-xs text-muted-foreground">Drag to compare</p>
        </div>

        {/* Applied edits */}
        <div className="hidden border-l p-6 md:block">
          <p className="text-xs font-medium text-muted-foreground">Applied</p>
          <ul className="mt-4 space-y-1">
            {APPLIED.map(({ icon: Icon, label, value }) => (
              <li key={label} className="flex items-center gap-3 rounded-xl px-2 py-2.5 hover:bg-surface">
                <span className="grid size-8 place-items-center rounded-lg bg-surface">
                  <Icon className="size-4 text-ink-2" />
                </span>
                <span className="flex-1 text-sm">{label}</span>
                <span className="text-sm text-muted-foreground">{value}</span>
              </li>
            ))}
          </ul>
          <div className="mt-6 rounded-xl border p-3">
            <p className="text-xs text-muted-foreground">Length</p>
            <p className="mt-1 font-mono text-sm">
              <span className="text-muted-foreground line-through">0:42</span> <span className="text-ink">0:31</span>
            </p>
          </div>
        </div>
      </div>
      <Timeline />
    </div>
  );
}

// Positions are % of the raw 0:42 recording.
const CUTS: [number, number][] = [[7, 3], [21, 5], [33, 2.5], [52, 4], [69, 3], [86, 4]];
const ZOOMS = [12, 40, 60, 78];

function Timeline() {
  return (
    <div className="hidden border-t px-6 py-4 md:block">
      <div className="grid grid-cols-[64px_1fr] items-center gap-x-4 gap-y-2 text-[11px] text-muted-foreground">
        <span>Voice</span>
        <div className="relative flex h-7 items-center gap-px overflow-hidden rounded-md bg-surface px-1">
          {Array.from({ length: 160 }, (_, i) => (
            <span
              key={i}
              className="w-full rounded-[1px] bg-ink/35"
              style={{ height: `${10 + Math.abs(Math.sin(i * 0.9) * Math.sin(i * 0.23)) * 80}%` }}
            />
          ))}
          {CUTS.map(([l, w]) => (
            <span
              key={l}
              className="absolute inset-y-0 border-x border-cut/50 bg-cut/15"
              style={{ left: `${l}%`, width: `${w}%` }}
            />
          ))}
        </div>
        <span>Zoom</span>
        <div className="relative h-3 rounded-md bg-surface">
          {ZOOMS.map((l) => (
            <span key={l} className="absolute inset-y-0 w-[8%] rounded-md bg-ink/80" style={{ left: `${l}%` }} />
          ))}
        </div>
        <span>Music</span>
        <div className="h-3 rounded-md bg-[linear-gradient(90deg,var(--rec)_0_6%,color-mix(in_oklch,var(--rec),white_70%)_6%_94%,var(--rec)_94%)]" />
      </div>
    </div>
  );
}

export function HomeHero() {
  return (
    <section className="overflow-hidden pt-20 pb-24 md:pt-28 md:pb-32">
      <Container>
        <div className="mx-auto max-w-4xl text-center motion-safe:animate-in motion-safe:fade-in motion-safe:slide-in-from-bottom-3 motion-safe:duration-700">
          <h1 className="text-[2.75rem] leading-[1.03] font-semibold tracking-[-0.04em] sm:text-6xl md:text-display">
            Talking videos,
            <br />
            beautifully edited.
          </h1>
          <p className="mx-auto mt-6 max-w-xl text-lg text-muted-foreground md:text-lead">
            Upload a raw video from your phone. Shortcraft adds captions, cuts the pauses, zooms in and adds
            music. Then you fine-tune anything, right in your browser.
          </p>
          <div className="mt-9 flex flex-wrap justify-center gap-3">
            <ButtonLink href="/signup" size="lg">
              Start for free
            </ButtonLink>
            <ButtonLink href="/editor/demo" variant="secondary" size="lg">
              Try the demo editor
            </ButtonLink>
          </div>
          <p className="mt-4 text-sm text-muted-foreground">5 free videos every month. No credit card.</p>
        </div>

        <div className="mt-16 md:mt-20 motion-safe:animate-in motion-safe:fade-in motion-safe:slide-in-from-bottom-8 motion-safe:delay-200 motion-safe:duration-1000 motion-safe:fill-mode-both">
          <ProductFrame />
        </div>
      </Container>
    </section>
  );
}
