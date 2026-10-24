"use client";

import { useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { AlertCircle, ArrowRight, Check } from "lucide-react";
import { toast } from "sonner";
import { isApiError, jobs as jobsApi, projects as projectsApi } from "@/lib/api";
import { derivePipeline, isPermanentFailure, loadPipeline, nextAutoJob, retryJob, type JobRequest, type LoadedPipeline, type PipelineStep, type StepKey } from "@/lib/api/pipeline";
import { projectIndex } from "@/lib/upload/project-index";
import { cn } from "@/lib/utils";
import { useProjectIndex, usePolling } from "./hooks";
import { pillButton } from "./project-dialogs";
import { ProjectThumb } from "./project-thumb";

const POLL_MS = 1500;

const COPY: Record<StepKey, { title: string; active: string; done: string }> = {
  upload: { title: "Upload", active: "Waiting for the upload to finish…", done: "Your video is safely in." },
  proxy: { title: "Preparing video", active: "Making a fast preview copy and thumbnails.", done: "Preview, audio and thumbnails ready." },
  transcribe: { title: "Listening", active: "Writing down every word, with timings.", done: "Every word transcribed." },
  plan: { title: "First edit", active: "Cutting pauses and fillers, adding captions, zooms and music.", done: "Your first edit is ready." },
};

/** Turn backend errors into something a creator can act on. */
function friendlyError(step: StepKey, raw: string | null): string {
  const text = raw ?? "";
  if (/no audio/i.test(text)) return "This video has no sound, so there’s nothing to caption or cut.";
  if (/ffprobe|ffmpeg|invalid data|moov atom/i.test(text)) return "We couldn’t read this video file. It may be damaged or use an unusual format.";
  if (/transcription failed/i.test(text)) return "The transcription service didn’t answer. Trying again usually works.";
  if (/cancel/i.test(text)) return "The upload was cancelled before it finished.";
  if (step === "plan") return "Building the first edit failed. Trying again usually works.";
  return text ? text : "Something went wrong on our side.";
}

export function ProcessingView({ projectId }: { projectId: string }) {
  const search = useSearchParams();
  const index = useProjectIndex();
  const local = index[projectId];
  const sourceId = search.get("source") ?? local?.sourceId ?? null;
  const [busy, setBusy] = useState(false);

  const project = usePolling(`project:${projectId}`, (signal) => projectsApi.get(projectId, { signal }));

  const refs = {
    sourceId,
    transcribeJobId: local?.jobs?.transcribe ?? null,
    planJobId: local?.jobs?.plan ?? null,
    vibe: local?.vibe ?? null,
  };
  const key = `${projectId}:${refs.sourceId}:${refs.transcribeJobId}:${refs.planJobId}`;

  const startJob = async (req: JobRequest, sid: string) => {
    const job = await jobsApi.create(projectId, { kind: req.kind, source_id: sid, params: req.params });
    projectIndex.update(projectId, (prev) => {
      const jobs = { ...prev.jobs };
      if (req.kind === "proxy") return { ...prev, sourceId: sid, jobs: {} };
      if (req.kind === "transcribe") return { ...prev, sourceId: sid, jobs: { transcribe: job.id } };
      jobs.plan = job.id;
      return { ...prev, sourceId: sid, jobs };
    });
    return job;
  };

  const { data, error, refresh } = usePolling<LoadedPipeline>(
    key,
    async (signal) => {
      const loaded = await loadPipeline(projectId, refs, signal);
      if (loaded.sourceId && loaded.sourceId !== local?.sourceId) projectIndex.update(projectId, { sourceId: loaded.sourceId });
      // Start what the backend chain didn't (chaining off, or the vibe differs from the default).
      const auto = nextAutoJob(loaded);
      if (auto && loaded.sourceId && !signal.aborted) await startJob(auto, loaded.sourceId);
      return loaded;
    },
    { intervalMs: POLL_MS, shouldContinue: (d) => derivePipeline(d).phase === "working" },
  );

  const pipeline = data ? derivePipeline(data) : null;
  const projectMissing = isApiError(project.error) && project.error.isNotFound;
  const offline = !data && isApiError(error) && error.isNetwork;
  const title = project.data?.title ?? "Your video";
  const failedStep = pipeline?.steps.find((s) => s.state === "failed") ?? null;
  const canRetry = !!failedStep && failedStep.key !== "upload" && !isPermanentFailure(failedStep.error);

  const retry = async () => {
    if (!pipeline?.failed || !data?.sourceId) return;
    const req = retryJob(pipeline.failed, data.vibe);
    if (!req) return;
    setBusy(true);
    try {
      await startJob(req, data.sourceId);
      refresh();
    } catch (err) {
      toast.error(isApiError(err) ? err.message : "Couldn’t restart that step.");
    } finally {
      setBusy(false);
    }
  };

  if (projectMissing) {
    return (
      <Shell>
        <h1 className="text-[1.75rem] font-semibold tracking-[-0.03em]">This project doesn’t exist</h1>
        <p className="mt-2 text-muted-foreground">It may have been deleted.</p>
        <Link href="/dashboard" className={cn(pillButton("primary"), "mt-6")}>
          Back to projects
        </Link>
      </Shell>
    );
  }

  const phase = pipeline?.phase ?? "working";
  const heading =
    phase === "ready"
      ? "Your first edit is ready"
      : phase === "failed"
        ? "We hit a snag"
        : phase === "empty"
          ? "Nothing to edit yet"
          : "Editing your video";
  const lead =
    phase === "ready"
      ? "Pauses and fillers are cut, captions and zooms are in. Open the editor to make it yours."
      : phase === "failed"
        ? canRetry
          ? "One step didn’t finish. You can try it again, or open the editor with what we have."
          : "This video can’t get an automatic edit. You can still open it in the editor, or upload another one."
        : phase === "empty"
          ? "We couldn’t find a video for this project in this browser. Upload one to start the edit."
          : "This usually takes about a minute. You can leave this page; we’ll keep going.";

  return (
    <Shell>
      <div className="flex items-start gap-5">
        <ProjectThumb poster={local?.poster} boxAspect={9 / 16} className="hidden aspect-[9/16] w-[72px] shrink-0 rounded-[12px] sm:block" />
        <div className="min-w-0">
          <p className="truncate text-[14px] text-muted-foreground">{title}</p>
          <h1 className="mt-1 text-[1.75rem] leading-tight font-semibold tracking-[-0.03em] sm:text-[2.25rem]" aria-live="polite">
            {heading}
          </h1>
          <p className="mt-2 text-[16px] text-muted-foreground">{lead}</p>
        </div>
      </div>

      {offline ? (
        <p role="alert" className="mt-8 rounded-[12px] bg-surface px-4 py-3 text-[14px] text-ink-2">
          Can’t reach the Shortcraft server right now. We’ll keep trying.
        </p>
      ) : null}

      {phase !== "empty" && (
        <ol className="mt-10 rounded-[20px] border border-line" aria-label="Progress">
          {(pipeline?.steps ?? (["upload", "proxy", "transcribe", "plan"] as StepKey[]).map((k) => ({ key: k, state: "waiting", progress: null, error: null }) as PipelineStep)).map(
            (step, i, all) => (
              <StepRow key={step.key} step={step} last={i === all.length - 1} />
            ),
          )}
        </ol>
      )}

      <div className="mt-8 flex flex-col gap-3 sm:flex-row sm:items-center">
        {phase === "ready" && (
          <Link href={`/editor/${projectId}`} className={cn(pillButton("primary"), "h-12 px-7")}>
            Open editor
            <ArrowRight className="size-4" aria-hidden />
          </Link>
        )}
        {phase === "failed" && (
          <>
            {canRetry && (
              <button type="button" className={cn(pillButton("primary"), "h-12 px-7")} disabled={busy} onClick={retry}>
                {busy ? "Restarting…" : "Try again"}
              </button>
            )}
            {!canRetry && (
              <Link href="/new" className={cn(pillButton("primary"), "h-12 px-7")}>
                {failedStep?.key === "upload" ? "Upload again" : "Upload another video"}
              </Link>
            )}
            <Link href={`/editor/${projectId}`} className={cn(pillButton("secondary"), "h-12 px-7")}>
              Open editor anyway
            </Link>
          </>
        )}
        {phase === "empty" && (
          <Link href="/new" className={cn(pillButton("primary"), "h-12 px-7")}>
            Upload a video
          </Link>
        )}
        <Link href="/dashboard" className={cn(pillButton("ghost"), "sm:ml-auto")}>
          Back to projects
        </Link>
      </div>
      {/* The editor still runs on the demo project only; loading a real plan comes with E8. */}
      {phase === "ready" && (
        <p className="mt-4 text-[13px] text-muted-foreground">Heads up: the editor shows the demo project until real projects are wired in.</p>
      )}
    </Shell>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return <div className="mx-auto w-full max-w-[680px] px-5 py-10 sm:px-8 sm:py-16">{children}</div>;
}

function StepRow({ step, last }: { step: PipelineStep; last: boolean }) {
  const copy = COPY[step.key];
  const { state } = step;
  const pct = step.progress ?? 0;
  return (
    <li
      className={cn("flex gap-4 px-5 py-4 sm:px-6 sm:py-5", !last && "border-b border-line")}
      aria-current={state === "active" ? "step" : undefined}
    >
      <StepIcon state={state} />
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline gap-3">
          <p className={cn("text-[16px] font-medium", state === "waiting" ? "text-muted-foreground" : "text-ink")}>{copy.title}</p>
          {state === "active" && step.key !== "upload" && (
            <span className="ml-auto font-mono text-[13px] text-ink-2 tabular-nums">{pct}%</span>
          )}
        </div>
        <p className={cn("mt-0.5 text-[14px]", state === "failed" ? "text-[#b42318]" : "text-muted-foreground")}>
          {state === "failed"
            ? friendlyError(step.key, step.error)
            : state === "done"
              ? copy.done
              : state === "active"
                ? copy.active
                : "Up next"}
        </p>
        {state === "active" && step.key !== "upload" && (
          <div
            role="progressbar"
            aria-label={`${copy.title} progress`}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={pct}
            className="mt-3 h-1 overflow-hidden rounded-full bg-surface"
          >
            <div className="h-full rounded-full bg-ink transition-[width] duration-700 ease-out" style={{ width: `${Math.max(pct, 3)}%` }} />
          </div>
        )}
      </div>
    </li>
  );
}

function StepIcon({ state }: { state: PipelineStep["state"] }) {
  if (state === "done") {
    return (
      <span className="mt-0.5 grid size-6 shrink-0 place-items-center rounded-full bg-ink text-white">
        <Check className="size-3.5" strokeWidth={3} aria-hidden />
        <span className="sr-only">Done</span>
      </span>
    );
  }
  if (state === "failed") {
    return (
      <span className="mt-0.5 grid size-6 shrink-0 place-items-center text-cut">
        <AlertCircle className="size-6" aria-hidden />
        <span className="sr-only">Failed</span>
      </span>
    );
  }
  if (state === "active") {
    return (
      <span className="relative mt-0.5 grid size-6 shrink-0 place-items-center">
        <span className="absolute inset-0 animate-spin rounded-full border-2 border-line border-t-rec motion-reduce:animate-none" aria-hidden />
        <span className="size-1.5 rounded-full bg-rec" aria-hidden />
        <span className="sr-only">In progress</span>
      </span>
    );
  }
  return (
    <span className="mt-0.5 size-6 shrink-0 rounded-full border-2 border-dashed border-line" aria-hidden>
      <span className="sr-only">Waiting</span>
    </span>
  );
}
