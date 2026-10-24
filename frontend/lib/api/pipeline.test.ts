import { describe, expect, it } from "vitest";
import { derivePipeline, nextAutoJob, retryJob, type PipelineSnapshot } from "./pipeline";
import type { Job, SourceDetail } from "./schemas";

const job = (kind: Job["kind"], status: Job["status"], extra: Partial<Job> = {}): Job => ({
  id: `${kind}-1`,
  project_id: "p1",
  kind,
  source_id: "s1",
  params: null,
  status,
  progress: status === "succeeded" ? 100 : 40,
  error: status === "failed" ? "ffprobe failed: bad file" : null,
  result: null,
  created_at: "2026-10-24T00:00:00Z",
  updated_at: "2026-10-24T00:00:00Z",
  ...extra,
});

const source = (status: SourceDetail["status"], proxy: Job | null): SourceDetail => ({
  id: "s1",
  project_id: "p1",
  filename: "talk.mp4",
  content_type: "video/mp4",
  size_bytes: 10,
  status,
  created_at: "2026-10-24T00:00:00Z",
  urls: {},
  proxy_job: proxy,
});

const snap = (patch: Partial<PipelineSnapshot>): PipelineSnapshot => ({
  source: null,
  transcribeJob: null,
  planJob: null,
  vibe: null,
  planExists: false,
  ...patch,
});

describe("derivePipeline", () => {
  it("shows the proxy step running with its progress", () => {
    const p = derivePipeline(snap({ source: source("processing", job("proxy", "running", { progress: 60 })) }));
    expect(p.phase).toBe("working");
    expect(p.steps.map((s) => s.state)).toEqual(["done", "active", "waiting", "waiting"]);
    expect(p.steps[1].progress).toBe(60);
  });

  it("is ready once the plan job succeeded in the chosen vibe", () => {
    const p = derivePipeline(
      snap({
        source: source("ready", job("proxy", "succeeded")),
        transcribeJob: job("transcribe", "succeeded"),
        planJob: job("plan", "succeeded", { params: { mode: "basic", vibe: "clean" } }),
        vibe: "clean",
      }),
    );
    expect(p.phase).toBe("ready");
  });

  it("keeps the plan step active while a plan in another vibe gets replaced", () => {
    const p = derivePipeline(
      snap({
        source: source("ready", job("proxy", "succeeded")),
        transcribeJob: job("transcribe", "succeeded"),
        planJob: job("plan", "succeeded", { params: { mode: "basic", vibe: "energetic" } }),
        vibe: "story",
      }),
    );
    expect(p.phase).toBe("working");
    expect(p.steps[3].state).toBe("active");
  });

  it("reports the failed step and its error", () => {
    const p = derivePipeline(snap({ source: source("failed", job("proxy", "failed")) }));
    expect(p.phase).toBe("failed");
    expect(p.failed).toBe("proxy");
    expect(p.steps[1].error).toContain("ffprobe");
  });

  it("without a source: ready when a plan exists, else empty", () => {
    expect(derivePipeline(snap({ planExists: true })).phase).toBe("ready");
    expect(derivePipeline(snap({})).phase).toBe("empty");
  });
});

describe("nextAutoJob", () => {
  it("waits while the backend chain is moving", () => {
    const proxy = job("proxy", "succeeded", { result: { transcribe_job_id: "t1" } });
    expect(nextAutoJob(snap({ source: source("ready", proxy) }))).toBeNull();
  });

  it("starts transcribe when the proxy did not chain one", () => {
    const proxy = job("proxy", "succeeded", { result: { transcribe_job_id: null } });
    expect(nextAutoJob(snap({ source: { ...source("ready", proxy), audio_codec: "aac" }, vibe: "clean" }))).toEqual({
      kind: "transcribe",
      params: { vibe: "clean" },
    });
  });

  it("re-plans once in the chosen vibe after the default plan", () => {
    const base = {
      source: source("ready", job("proxy", "succeeded", { result: { transcribe_job_id: "t1" } })),
      transcribeJob: job("transcribe", "succeeded", { result: { plan_job_id: "pl1" } }),
      vibe: "story",
    };
    expect(nextAutoJob(snap({ ...base, planJob: job("plan", "succeeded", { params: { vibe: "energetic" } }) }))).toEqual({
      kind: "plan",
      params: { mode: "basic", vibe: "story" },
    });
    expect(nextAutoJob(snap({ ...base, planJob: job("plan", "queued", { params: { vibe: "story" } }) }))).toBeNull();
  });

  it("does not transcribe a video without sound, and says why", () => {
    const silent = source("ready", job("proxy", "succeeded", { result: { transcribe_job_id: null } }));
    expect(nextAutoJob(snap({ source: silent }))).toBeNull();
    const p = derivePipeline(snap({ source: silent }));
    expect(p.failed).toBe("transcribe");
    expect(p.steps[2].error).toMatch(/no audio/);
  });

  it("retries the failed step with the vibe", () => {
    expect(retryJob("plan", "clean")).toEqual({ kind: "plan", params: { mode: "basic", vibe: "clean" } });
    expect(retryJob("upload", null)).toBeNull();
  });
});
