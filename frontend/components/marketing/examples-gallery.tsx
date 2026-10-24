"use client";

import { useState } from "react";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { CAPTION_PRESETS } from "@/lib/caption-presets";
import { DEMO_CLIPS, type DemoClip } from "@/lib/demo-clips";
import { cn } from "@/lib/utils";
import { BeforeAfter } from "./before-after";
import { PhoneVideo } from "./phone-video";

const CATEGORIES = ["All", ...Array.from(new Set(DEMO_CLIPS.map((c) => c.category)))];

export function ExamplesGallery() {
  const [category, setCategory] = useState("All");
  const [open, setOpen] = useState<DemoClip | null>(null);
  const clips = category === "All" ? DEMO_CLIPS : DEMO_CLIPS.filter((c) => c.category === category);

  return (
    <>
      <div className="flex flex-wrap justify-center gap-2" role="group" aria-label="Filter examples">
        {CATEGORIES.map((c) => (
          <button
            key={c}
            onClick={() => setCategory(c)}
            aria-pressed={c === category}
            className={cn(
              "rounded-full px-4 py-2 text-sm transition-colors",
              c === category ? "bg-ink text-white" : "bg-surface text-ink-2 hover:text-ink",
            )}
          >
            {c}
          </button>
        ))}
      </div>

      <ul className="mt-12 grid grid-cols-2 gap-x-4 gap-y-10 sm:grid-cols-3 lg:grid-cols-4">
        {clips.map((clip) => {
          const preset = CAPTION_PRESETS.find((p) => p.id === clip.presetId);
          return (
            <li key={clip.id}>
              <button onClick={() => setOpen(clip)} className="group block w-full text-left">
                <div className="transition-transform duration-300 group-hover:-translate-y-1">
                  <PhoneVideo clip={clip} captionSize={16} zoom={false} />
                </div>
                <p className="mt-4 font-medium">{clip.category}</p>
                <p className="text-sm text-muted-foreground">{preset?.name} captions · tap to compare</p>
              </button>
            </li>
          );
        })}
      </ul>

      <Dialog open={!!open} onOpenChange={(v) => !v && setOpen(null)}>
        <DialogContent className="max-w-[min(92vw,720px)] gap-0 overflow-hidden rounded-[24px] p-0 sm:max-w-[720px]">
          {open && (
            <div className="grid sm:grid-cols-[300px_1fr]">
              <div className="bg-surface p-6">
                <BeforeAfter clip={open} />
              </div>
              <div className="flex flex-col p-7">
                <DialogTitle className="text-2xl font-semibold tracking-[-0.02em]">{open.category}</DialogTitle>
                <DialogDescription className="mt-2 text-[15px]">
                  Drag the line on the video to compare the raw recording with the edit.
                </DialogDescription>
                <dl className="mt-7 divide-y border-y text-[15px]">
                  {[
                    ["Caption style", CAPTION_PRESETS.find((p) => p.id === open.presetId)?.name],
                    ["Hook title", open.hook],
                    ["Zoom-ins", "4"],
                    ["Music", "Ducked under speech"],
                  ].map(([k, v]) => (
                    <div key={k} className="flex justify-between gap-6 py-3">
                      <dt className="text-muted-foreground">{k}</dt>
                      <dd className="text-right">{v}</dd>
                    </div>
                  ))}
                </dl>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
