"use client";

import { useId, useRef, useState } from "react";
import { Upload } from "lucide-react";
import { ACCEPT_ATTR } from "@/lib/upload/validate";
import { cn } from "@/lib/utils";

/** Big drop target for one video. Click, Enter/Space or drag a file onto it. */
export function VideoDropzone({
  onFile,
  error,
  size = "lg",
  title = "Drop your video here",
  className,
}: {
  onFile: (file: File) => void;
  error?: string | null;
  size?: "md" | "lg";
  title?: string;
  className?: string;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [over, setOver] = useState(false);
  const hintId = useId();

  return (
    <div className={className}>
      <button
        type="button"
        aria-describedby={hintId}
        onClick={() => inputRef.current?.click()}
        onDragEnter={(e) => {
          e.preventDefault();
          setOver(true);
        }}
        onDragOver={(e) => {
          e.preventDefault();
          e.dataTransfer.dropEffect = "copy";
        }}
        onDragLeave={(e) => {
          if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setOver(false);
        }}
        onDrop={(e) => {
          e.preventDefault();
          setOver(false);
          const file = e.dataTransfer.files?.[0];
          if (file) onFile(file);
        }}
        className={cn(
          "group flex w-full flex-col items-center justify-center rounded-[20px] border border-dashed text-center transition-colors focus-visible:ring-3 focus-visible:ring-rec/40 focus-visible:outline-none",
          size === "lg" ? "min-h-[300px] px-6 py-14 sm:min-h-[340px]" : "min-h-[220px] px-6 py-10",
          over ? "border-rec bg-rec-soft/60" : "border-[#cfcfd6] bg-surface hover:border-ink-2/50 hover:bg-[#f0f0f3]",
        )}
      >
        <span
          className={cn(
            "grid size-14 place-items-center rounded-full bg-white shadow-[0_1px_2px_rgba(0,0,0,0.06)] ring-1 ring-line transition-transform",
            over ? "scale-105" : "group-hover:-translate-y-0.5",
          )}
        >
          <Upload className={cn("size-[22px]", over ? "text-rec" : "text-ink")} aria-hidden />
        </span>
        <span className="mt-5 text-[19px] font-semibold tracking-[-0.015em] text-ink">{over ? "Release to add it" : title}</span>
        <span className="mt-1.5 text-[15px] text-muted-foreground">
          or <span className="font-medium text-ink underline decoration-line underline-offset-4">choose a file</span>
        </span>
        <span id={hintId} className="mt-6 text-[13px] text-muted-foreground">
          MP4, MOV, WebM or MKV · up to 2 GB · a talking video works best
        </span>
      </button>
      <input
        ref={inputRef}
        type="file"
        accept={ACCEPT_ATTR}
        className="sr-only"
        tabIndex={-1}
        aria-hidden
        data-testid="video-input"
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) onFile(file);
          e.target.value = "";
        }}
      />
      {error && (
        <p role="alert" className="mt-3 text-center text-sm text-cut">
          {error}
        </p>
      )}
    </div>
  );
}
