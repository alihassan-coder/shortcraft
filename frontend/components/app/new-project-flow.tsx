"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowLeft, Film, X } from "lucide-react";
import { isApiError, projects as projectsApi } from "@/lib/api";
import { takePendingFile } from "@/lib/upload/pending-file";
import { projectIndex, type Vibe } from "@/lib/upload/project-index";
import { isAbortError } from "@/lib/upload/transport";
import { uploadFile, UploadError } from "@/lib/upload/upload-file";
import { checkVideoFile, formatBytes, formatDuration } from "@/lib/upload/validate";
import { cn } from "@/lib/utils";
import { VideoDropzone } from "./dropzone";
import { pillButton } from "./project-dialogs";
import { VIBES, VibePicker } from "./vibe-picker";

type Picked = { file: File; url: string; duration: number | null; poster: string | null; portrait: boolean | null };
type Step = 1 | 2 | 3;
type UploadState =
  | { phase: "idle" }
  | { phase: "uploading"; fraction: number; loaded: number; startedAt: number; at: number }
  | { phase: "finishing" }
  | { phase: "error"; message: string };

const STEPS = ["Video", "Vibe", "Upload"] as const;

function titleFromFile(name: string) {
  const base = name.replace(/\.[^.]+$/, "").replace(/[_-]+/g, " ").trim();
  return (base || "Untitled video").slice(0, 120);
}

/** First frame as a small JPEG (dashboard thumbnail until the backend's sprite exists). */
function capturePoster(video: HTMLVideoElement): string | null {
  try {
    const w = 320;
    const h = Math.round((video.videoHeight / video.videoWidth) * w) || 568;
    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    canvas.getContext("2d")?.drawImage(video, 0, 0, w, h);
    return canvas.toDataURL("image/jpeg", 0.72);
  } catch {
    return null;
  }
}

export function NewProjectFlow() {
  const router = useRouter();
  const [step, setStep] = useState<Step>(1);
  const [picked, setPicked] = useState<Picked | null>(null);
  const [pickError, setPickError] = useState<string | null>(null);
  const [title, setTitle] = useState("");
  const [vibe, setVibe] = useState<Vibe>("energetic");
  const [upload, setUpload] = useState<UploadState>({ phase: "idle" });
  const controllerRef = useRef<AbortController | null>(null);
  const projectIdRef = useRef<string | null>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);

  const pick = (file: File) => {
    const check = checkVideoFile(file);
    if (!check.ok) {
      setPickError(check.reason);
      return;
    }
    setPickError(null);
    setPicked((prev) => {
      if (prev) URL.revokeObjectURL(prev.url);
      return { file, url: URL.createObjectURL(file), duration: null, poster: null, portrait: null };
    });
    setTitle(titleFromFile(file.name));
  };

  // A file dropped on the dashboard arrives here.
  useEffect(() => {
    const file = takePendingFile();
    if (file) queueMicrotask(() => pick(file));
  }, []);

  useEffect(() => () => controllerRef.current?.abort(), []);
  useEffect(() => headingRef.current?.focus(), [step]);

  const startUpload = async () => {
    if (!picked) return;
    const controller = new AbortController();
    controllerRef.current = controller;
    setUpload({ phase: "uploading", fraction: 0, loaded: 0, startedAt: Date.now(), at: Date.now() });
    try {
      let projectId = projectIdRef.current;
      if (!projectId) {
        const project = await projectsApi.create(title.trim() || titleFromFile(picked.file.name), { signal: controller.signal });
        projectId = project.id;
        projectIdRef.current = projectId;
      }
      projectIndex.update(projectId, {
        vibe,
        poster: picked.poster ?? undefined,
        durationS: picked.duration ?? undefined,
        jobs: {},
      });
      const pid = projectId;
      const startedAt = Date.now();
      const result = await uploadFile(pid, picked.file, {
        signal: controller.signal,
        onSource: (source) => projectIndex.update(pid, { sourceId: source.id }),
        onProgress: ({ fraction, loaded }) =>
          setUpload(fraction >= 1 ? { phase: "finishing" } : { phase: "uploading", fraction, loaded, startedAt, at: Date.now() }),
      });
      setUpload({ phase: "finishing" });
      router.replace(`/projects/${pid}/processing?source=${result.source.id}`);
    } catch (err) {
      if (controller.signal.aborted || isAbortError(err)) {
        // Nothing useful is left on the server: drop the empty project too.
        const id = projectIdRef.current;
        projectIdRef.current = null;
        if (id) {
          projectIndex.remove(id);
          void projectsApi.remove(id).catch(() => undefined);
        }
        setUpload({ phase: "idle" });
        setStep(2);
        return;
      }
      const message =
        err instanceof UploadError || isApiError(err)
          ? isApiError(err) && err.isNetwork
            ? "Can’t reach the Shortcraft server. Check your connection and try again."
            : err.message
          : err instanceof Error
            ? err.message
            : "The upload failed.";
      setUpload({ phase: "error", message });
    } finally {
      controllerRef.current = null;
    }
  };

  const go = (next: Step) => {
    setStep(next);
    if (next === 3) void startUpload();
  };

  return (
    <div className="mx-auto w-full max-w-[760px] px-5 py-8 sm:px-8 sm:py-12">
      <Stepper step={step} />

      {step === 1 && (
        <section aria-labelledby="step-title" className="mt-8">
          <StepHeading ref={headingRef} title="Add your video" lead="One take, straight from your phone or camera. We’ll do the editing." />
          {!picked ? (
            <VideoDropzone className="mt-7" onFile={pick} error={pickError} />
          ) : (
            <>
              <PickedPreview
                picked={picked}
                onMeta={(meta) => setPicked((p) => (p && p.url === picked.url ? { ...p, ...meta } : p))}
                onClear={() => {
                  URL.revokeObjectURL(picked.url);
                  setPicked(null);
                }}
              />
              <div className="mt-6">
                <label htmlFor="new-title" className="mb-2 block text-sm font-medium">
                  Project name
                </label>
                <input
                  id="new-title"
                  value={title}
                  maxLength={200}
                  onChange={(e) => setTitle(e.target.value)}
                  className="h-12 w-full rounded-[12px] border border-input bg-white px-4 text-[15px] outline-none focus:border-rec focus:ring-3 focus:ring-rec/20"
                />
              </div>
              <div className="mt-8 flex justify-end">
                <button type="button" className={cn(pillButton("primary"), "h-12 px-7")} disabled={!title.trim()} onClick={() => go(2)}>
                  Continue
                </button>
              </div>
            </>
          )}
        </section>
      )}

      {step === 2 && (
        <section aria-labelledby="step-title" className="mt-8">
          <StepHeading ref={headingRef} title="Pick a vibe" lead="Sets the captions, zooms and music of the first edit. You can change any of it later." />
          <div className="mt-7">
            <VibePicker value={vibe} onChange={setVibe} poster={picked?.poster} />
          </div>
          <div className="mt-8 flex items-center justify-between">
            <button type="button" className={pillButton("ghost")} onClick={() => setStep(1)}>
              <ArrowLeft className="size-4" aria-hidden />
              Back
            </button>
            <button type="button" className={cn(pillButton("primary"), "h-12 px-7")} onClick={() => go(3)}>
              Upload and edit
            </button>
          </div>
        </section>
      )}

      {step === 3 && picked && (
        <section aria-labelledby="step-title" className="mt-8">
          <StepHeading
            ref={headingRef}
            title={upload.phase === "error" ? "The upload stopped" : "Uploading your video"}
            lead={
              upload.phase === "error"
                ? "Nothing is lost. Your file is still here, so you can try again."
                : "Keep this tab open until it’s done. The editing starts right after."
            }
          />
          <UploadPanel
            picked={picked}
            vibe={vibe}
            state={upload}
            onCancel={() => controllerRef.current?.abort()}
            onRetry={() => void startUpload()}
            onBack={() => {
              setUpload({ phase: "idle" });
              setStep(2);
            }}
          />
        </section>
      )}
    </div>
  );
}

function Stepper({ step }: { step: Step }) {
  return (
    <ol className="flex items-center gap-2 text-[13px]" aria-label="Steps">
      {STEPS.map((label, i) => {
        const n = (i + 1) as Step;
        const state = n < step ? "done" : n === step ? "current" : "todo";
        return (
          <li key={label} className="flex items-center gap-2" aria-current={state === "current" ? "step" : undefined}>
            {i > 0 && <span aria-hidden className={cn("h-px w-6 sm:w-10", n <= step ? "bg-ink" : "bg-line")} />}
            <span
              className={cn(
                "grid size-6 place-items-center rounded-full font-mono text-[11px] font-medium",
                state === "current" && "bg-ink text-white",
                state === "done" && "bg-surface text-ink ring-1 ring-ink/80",
                state === "todo" && "bg-surface text-muted-foreground",
              )}
            >
              {n}
            </span>
            <span className={cn(state === "todo" ? "text-muted-foreground" : "font-medium text-ink")}>{label}</span>
          </li>
        );
      })}
    </ol>
  );
}

function StepHeading({ title, lead, ref }: { title: string; lead: string; ref: React.Ref<HTMLHeadingElement> }) {
  return (
    <div>
      <h1 id="step-title" ref={ref} tabIndex={-1} className="text-[1.75rem] leading-tight font-semibold tracking-[-0.03em] outline-none sm:text-[2.25rem]">
        {title}
      </h1>
      <p className="mt-2 text-[16px] text-muted-foreground">{lead}</p>
    </div>
  );
}

function PickedPreview({
  picked,
  onMeta,
  onClear,
}: {
  picked: Picked;
  onMeta: (meta: Partial<Picked>) => void;
  onClear: () => void;
}) {
  const [unplayable, setUnplayable] = useState(false);
  return (
    <div className="mt-7 flex flex-col gap-5 rounded-[20px] border border-line p-3 sm:flex-row sm:items-center sm:gap-6">
      <div className="relative mx-auto aspect-[9/16] w-40 shrink-0 overflow-hidden rounded-[14px] bg-[#141416] sm:mx-0 sm:w-36">
        {unplayable ? (
          <div className="absolute inset-0 grid place-items-center p-3 text-center text-[12px] text-white/70">
            <Film className="mx-auto mb-2 size-5" aria-hidden />
            No preview for this format. It will still upload.
          </div>
        ) : (
          <video
            src={picked.url}
            muted
            playsInline
            preload="auto"
            controls={false}
            className="absolute inset-0 size-full object-cover"
            aria-label={`Preview of ${picked.file.name}`}
            onLoadedMetadata={(e) => {
              const v = e.currentTarget;
              onMeta({ duration: Number.isFinite(v.duration) ? v.duration : null, portrait: v.videoHeight >= v.videoWidth });
              // Some browsers paint nothing until a seek; 0.1 s also skips a black first frame.
              if (v.currentTime === 0) v.currentTime = Math.min(0.1, v.duration || 0);
            }}
            onSeeked={(e) => {
              if (!picked.poster) onMeta({ poster: capturePoster(e.currentTarget) });
            }}
            onError={() => setUnplayable(true)}
            onMouseEnter={(e) => void e.currentTarget.play().catch(() => undefined)}
            onMouseLeave={(e) => e.currentTarget.pause()}
          />
        )}
      </div>
      <div className="min-w-0 flex-1 px-1 pb-1 sm:py-2">
        <p className="truncate text-[16px] font-medium text-ink" title={picked.file.name}>
          {picked.file.name}
        </p>
        <dl className="mt-3 grid grid-cols-3 gap-3 text-[13px] sm:max-w-sm">
          <div>
            <dt className="text-muted-foreground">Length</dt>
            <dd className="mt-0.5 font-mono text-ink tabular-nums">{picked.duration != null ? formatDuration(picked.duration) : "--:--"}</dd>
          </div>
          <div>
            <dt className="text-muted-foreground">Size</dt>
            <dd className="mt-0.5 font-mono text-ink tabular-nums">{formatBytes(picked.file.size)}</dd>
          </div>
          <div>
            <dt className="text-muted-foreground">Shape</dt>
            <dd className="mt-0.5 text-ink">{picked.portrait == null ? "—" : picked.portrait ? "Vertical" : "Horizontal"}</dd>
          </div>
        </dl>
        <button type="button" onClick={onClear} className={cn(pillButton("secondary"), "mt-5 h-9 px-4 text-[14px]")}>
          Choose another video
        </button>
      </div>
    </div>
  );
}

function UploadPanel({
  picked,
  vibe,
  state,
  onCancel,
  onRetry,
  onBack,
}: {
  picked: Picked;
  vibe: Vibe;
  state: UploadState;
  onCancel: () => void;
  onRetry: () => void;
  onBack: () => void;
}) {
  const fraction = state.phase === "uploading" ? state.fraction : state.phase === "finishing" ? 1 : 0;
  const pct = Math.round(fraction * 100);
  let detail = "Starting…";
  if (state.phase === "uploading" && state.loaded > 0) {
    const elapsed = (state.at - state.startedAt) / 1000;
    const rate = state.loaded / Math.max(elapsed, 0.001);
    const left = (picked.file.size - state.loaded) / Math.max(rate, 1);
    detail = `${formatBytes(state.loaded)} of ${formatBytes(picked.file.size)}${elapsed > 2 && left > 1 ? ` · about ${formatDuration(left)} left` : ""}`;
  } else if (state.phase === "finishing") {
    detail = "Done. Starting the edit…";
  }
  const vibeName = VIBES.find((v) => v.id === vibe)?.name ?? vibe;

  return (
    <div className="mt-7 rounded-[20px] border border-line p-5 sm:p-6">
      <div className="flex items-center gap-4">
        <div className="relative size-14 shrink-0 overflow-hidden rounded-[10px] bg-[#141416]">
          {picked.poster && (
            // eslint-disable-next-line @next/next/no-img-element -- local data URL
            <img src={picked.poster} alt="" className="absolute inset-0 size-full object-cover" />
          )}
        </div>
        <div className="min-w-0 flex-1">
          <p className="truncate text-[15px] font-medium">{picked.file.name}</p>
          <p className="mt-0.5 text-[13px] text-muted-foreground">
            {formatBytes(picked.file.size)} · {vibeName} vibe
          </p>
        </div>
        {state.phase !== "error" && (
          <span className="font-mono text-[15px] text-ink tabular-nums" aria-hidden>
            {pct}%
          </span>
        )}
      </div>

      {state.phase === "error" ? (
        <>
          <p role="alert" className="mt-5 rounded-[12px] bg-[#fef3f2] px-4 py-3 text-[14px] text-[#b42318]">
            {state.message}
          </p>
          <div className="mt-6 flex flex-col-reverse gap-2 sm:flex-row sm:justify-between">
            <button type="button" className={pillButton("ghost")} onClick={onBack}>
              <ArrowLeft className="size-4" aria-hidden />
              Back
            </button>
            <button type="button" className={pillButton("primary")} onClick={onRetry}>
              Try again
            </button>
          </div>
        </>
      ) : (
        <>
          <div
            role="progressbar"
            aria-label="Upload progress"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={pct}
            className="mt-5 h-1.5 overflow-hidden rounded-full bg-surface"
          >
            <div className="h-full rounded-full bg-ink transition-[width] duration-300 ease-out" style={{ width: `${Math.max(pct, 1)}%` }} />
          </div>
          <div className="mt-3 flex items-center justify-between gap-3">
            <p className="text-[13px] text-muted-foreground tabular-nums" aria-live="polite">
              {detail}
            </p>
            {state.phase === "uploading" && (
              <button type="button" onClick={onCancel} className={cn(pillButton("ghost"), "-mr-2 h-9 px-3.5 text-[14px] text-ink-2")}>
                <X className="size-4" aria-hidden />
                Cancel
              </button>
            )}
          </div>
        </>
      )}
    </div>
  );
}
