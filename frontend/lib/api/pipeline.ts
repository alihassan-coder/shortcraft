import { isApiError } from "./http";
import { jobs as jobsApi, plan as planApi, sourceIdFromStorageKey, sources as sourcesApi } from "./index";
import type { Job, JobKind, PlanRead, SourceDetail } from "./schemas";

// The backend chains proxy -> transcribe -> plan by itself. This module turns what we can
// read (the source with its latest proxy job, then the chained job ids in each result) into
// the four steps the "agents working" screen shows, and decides when the client must start
// a job itself (chaining switched off, a retry, or a different vibe than the default).

export type StepKey = "upload" | "proxy" | "transcribe" | "plan";
export type StepState = "waiting" | "active" | "done" | "failed";
export type PipelineStep = { key: StepKey; state: StepState; progress: number | null; error: string | null };

export type PipelineSnapshot = {
  source: SourceDetail | null;
  transcribeJob: Job | null;
  planJob: Job | null;
  /** The vibe chosen on /new (null: whatever the backend picked). */
  vibe: string | null;
  /** A saved plan exists (only checked when there is no source to follow). */
  planExists: boolean;
};

export type Pipeline = {
  steps: PipelineStep[];
  phase: "working" | "ready" | "failed" | "empty";
  failed: StepKey | null;
};

const DEFAULT_VIBE = "energetic";

/** Same wording as the backend's transcribe error, so the UI maps both the same way. */
export const NO_AUDIO = "This video has no audio track to transcribe";

/** The proxy job fills `audio_codec`; null after it succeeded means there is no sound. */
export function hasNoAudio(source: SourceDetail): boolean {
  return source.proxy_job?.status === "succeeded" && !source.audio_codec;
}

/** Failures that "Try again" cannot fix. */
export function isPermanentFailure(error: string | null): boolean {
  return !!error && /no audio track/i.test(error);
}

export function chainedJobId(job: Job | null | undefined, key: "transcribe_job_id" | "plan_job_id"): string | null {
  const value = job?.status === "succeeded" ? job.result?.[key] : null;
  return typeof value === "string" && value ? value : null;
}

function planVibe(job: Job | null): string {
  const v = job?.params?.vibe;
  return typeof v === "string" ? v : DEFAULT_VIBE;
}

function planMatchesVibe(snapshot: PipelineSnapshot) {
  return !snapshot.vibe || planVibe(snapshot.planJob) === snapshot.vibe;
}

function jobStep(key: StepKey, job: Job | null, startedBefore: boolean): PipelineStep {
  if (!job) return { key, state: startedBefore ? "active" : "waiting", progress: null, error: null };
  switch (job.status) {
    case "succeeded":
      return { key, state: "done", progress: 100, error: null };
    case "failed":
      return { key, state: "failed", progress: null, error: job.error ?? "Something went wrong." };
    case "running":
      return { key, state: "active", progress: job.progress ?? 0, error: null };
    default:
      return { key, state: "active", progress: 0, error: null };
  }
}

export function derivePipeline(snapshot: PipelineSnapshot): Pipeline {
  const { source, transcribeJob, planJob } = snapshot;

  if (!source) {
    const done: PipelineStep = { key: "upload", state: "done", progress: 100, error: null };
    if (snapshot.planExists) {
      return {
        steps: (["upload", "proxy", "transcribe", "plan"] as StepKey[]).map((key) => ({ ...done, key })),
        phase: "ready",
        failed: null,
      };
    }
    return {
      steps: (["upload", "proxy", "transcribe", "plan"] as StepKey[]).map((key) => ({
        key,
        state: "waiting",
        progress: null,
        error: null,
      })),
      phase: "empty",
      failed: null,
    };
  }

  const upload: PipelineStep =
    source.status === "pending"
      ? { key: "upload", state: "active", progress: null, error: null }
      : source.status === "aborted"
        ? { key: "upload", state: "failed", progress: null, error: "The upload was cancelled." }
        : { key: "upload", state: "done", progress: 100, error: null };

  const proxyJob = source.proxy_job ?? null;
  let proxy = jobStep("proxy", proxyJob, upload.state === "done");
  if (source.status === "failed" && proxy.state !== "failed") {
    proxy = { key: "proxy", state: "failed", progress: null, error: proxyJob?.error ?? "We couldn't read this video." };
  }
  let transcribe = jobStep("transcribe", transcribeJob, proxy.state === "done");
  if (!transcribeJob && proxy.state === "done" && hasNoAudio(source)) {
    transcribe = { key: "transcribe", state: "failed", progress: null, error: NO_AUDIO };
  }
  let plan = jobStep("plan", planJob, transcribe.state === "done");
  // A plan in another vibe is about to be replaced by ours.
  if (plan.state === "done" && !planMatchesVibe(snapshot)) plan = { ...plan, state: "active", progress: 0 };

  const steps = [upload, proxy, transcribe, plan];
  const failedStep = steps.find((s) => s.state === "failed") ?? null;
  return {
    steps,
    phase: failedStep ? "failed" : plan.state === "done" ? "ready" : "working",
    failed: failedStep?.key ?? null,
  };
}

export type JobRequest = { kind: JobKind; params: Record<string, unknown> };

const vibeParams = (vibe: string | null) => (vibe ? { vibe } : {});

/** The job the client should start now, if any (null while the backend's chain is moving). */
export function nextAutoJob(snapshot: PipelineSnapshot): JobRequest | null {
  const { source, transcribeJob, planJob, vibe } = snapshot;
  if (!source || source.status === "failed") return null;
  const proxyJob = source.proxy_job ?? null;
  if (proxyJob?.status !== "succeeded") return null;
  if (!transcribeJob && !chainedJobId(proxyJob, "transcribe_job_id")) {
    if (hasNoAudio(source)) return null;
    return { kind: "transcribe", params: vibeParams(vibe) };
  }
  if (transcribeJob?.status !== "succeeded") return null;
  if (!planJob && !chainedJobId(transcribeJob, "plan_job_id")) {
    return { kind: "plan", params: { mode: "basic", ...vibeParams(vibe) } };
  }
  if (planJob?.status === "succeeded" && vibe && planVibe(planJob) !== vibe) {
    return { kind: "plan", params: { mode: "basic", vibe } };
  }
  return null;
}

/** What "Try again" starts for a failed step. */
export function retryJob(step: StepKey, vibe: string | null): JobRequest | null {
  switch (step) {
    case "proxy":
      return { kind: "proxy", params: vibeParams(vibe) };
    case "transcribe":
      return { kind: "transcribe", params: vibeParams(vibe) };
    case "plan":
      return { kind: "plan", params: { mode: "basic", ...vibeParams(vibe) } };
    default:
      return null;
  }
}

// --- Loading -------------------------------------------------------------------------------

export type PipelineRefs = {
  sourceId?: string | null;
  /** Jobs this browser started by hand; they win over the chained ids. */
  transcribeJobId?: string | null;
  planJobId?: string | null;
  vibe?: string | null;
  /** Also GET the plan (dashboard; and whenever no source id is known). */
  checkPlan?: boolean;
};

export type LoadedPipeline = PipelineSnapshot & { sourceId: string | null; planRevision: number | null };

const orNull = <T>(promise: Promise<T>): Promise<T | null> =>
  promise.catch((err: unknown) => {
    if (isApiError(err) && err.isNotFound) return null;
    throw err;
  });

/** Everything the steps need, in as few requests as the chain allows (1 to 4). */
export async function loadPipeline(projectId: string, refs: PipelineRefs, signal?: AbortSignal): Promise<LoadedPipeline> {
  let sourceId = refs.sourceId ?? null;
  let planRead: PlanRead | null = null;
  if (refs.checkPlan || !sourceId) {
    planRead = await orNull(planApi.get(projectId, { signal }));
    if (!sourceId) {
      const keys = planRead?.plan.sources?.map((s) => s.src) ?? [];
      sourceId = keys.map((k) => sourceIdFromStorageKey(k, projectId)).find(Boolean) ?? null;
    }
  }
  const source = sourceId ? await orNull(sourcesApi.get(projectId, sourceId, { signal })) : null;
  const transcribeId = refs.transcribeJobId ?? chainedJobId(source?.proxy_job, "transcribe_job_id");
  const transcribeJob = transcribeId ? await orNull(jobsApi.get(projectId, transcribeId, { signal })) : null;
  const planId = refs.planJobId ?? chainedJobId(transcribeJob, "plan_job_id");
  const planJob = planId ? await orNull(jobsApi.get(projectId, planId, { signal })) : null;
  return {
    source,
    sourceId,
    transcribeJob,
    planJob,
    vibe: refs.vibe ?? null,
    planExists: planRead !== null,
    planRevision: planRead?.revision ?? null,
  };
}
