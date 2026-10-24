import { z } from "zod";
import { etagForRevision, request, requestRaw, revisionFromEtag, type RequestOptions } from "./http";
import {
  jobSchema,
  planReadSchema,
  planResolvedSchema,
  projectSchema,
  sourceDetailSchema,
  sourceSchema,
  spriteIndexSchema,
  uploadCreatedSchema,
  type CompletedPart,
  type JobKind,
  type PlanRead,
  type PlanResolved,
} from "./schemas";

export * from "./http";
export * from "./schemas";

type Opts = Pick<RequestOptions, "signal" | "fetch">;

const p = (projectId: string) => `/projects/${encodeURIComponent(projectId)}`;
const s = (projectId: string, sourceId: string) => `${p(projectId)}/sources/${encodeURIComponent(sourceId)}`;

export const projects = {
  list: (opts?: Opts & { limit?: number; offset?: number }) =>
    request(`/projects?limit=${opts?.limit ?? 100}&offset=${opts?.offset ?? 0}`, z.array(projectSchema), opts),
  create: (title: string, opts?: Opts) => request("/projects", projectSchema, { ...opts, method: "POST", body: { title } }),
  get: (projectId: string, opts?: Opts) => request(p(projectId), projectSchema, opts),
  rename: (projectId: string, title: string, opts?: Opts) =>
    request(p(projectId), projectSchema, { ...opts, method: "PATCH", body: { title } }),
  remove: (projectId: string, opts?: Opts) => request(p(projectId), null, { ...opts, method: "DELETE" }),
};

export const uploads = {
  start: (projectId: string, file: { filename: string; content_type: string; size_bytes: number }, opts?: Opts) =>
    request(`${p(projectId)}/uploads`, uploadCreatedSchema, { ...opts, method: "POST", body: file }),
  /** Single uploads: no parts. Multipart: every part's ETag. Idempotent on the backend. */
  complete: (projectId: string, sourceId: string, parts?: CompletedPart[], opts?: Opts) =>
    request(`${s(projectId, sourceId)}/complete`, sourceSchema, {
      ...opts,
      method: "POST",
      body: parts ? { parts } : undefined,
    }),
  abort: (projectId: string, sourceId: string, opts?: Opts) =>
    request(`${s(projectId, sourceId)}/abort`, sourceSchema, { ...opts, method: "POST" }),
};

export const sources = {
  get: (projectId: string, sourceId: string, opts?: Opts) => request(s(projectId, sourceId), sourceDetailSchema, opts),
  /** Thumbnail sheet index (`urls.sprite_index`); an absolute URL from the source detail. */
  spriteIndex: async (url: string, opts?: Opts) => {
    const res = await (opts?.fetch ?? fetch)(url, { signal: opts?.signal });
    if (!res.ok) return null;
    const parsed = spriteIndexSchema.safeParse(await res.json().catch(() => null));
    return parsed.success ? parsed.data : null;
  },
};

export type JobParams = Record<string, unknown>;

export const jobs = {
  get: (projectId: string, jobId: string, opts?: Opts) =>
    request(`${p(projectId)}/jobs/${encodeURIComponent(jobId)}`, jobSchema, opts),
  create: (projectId: string, job: { kind: JobKind; source_id?: string; params?: JobParams }, opts?: Opts) =>
    request(`${p(projectId)}/jobs`, jobSchema, { ...opts, method: "POST", body: job }),
};

export const plan = {
  /** The stored plan (media as storage keys). Save from this one. */
  get: async (projectId: string, opts?: Opts): Promise<PlanRead> => {
    const { data, headers } = await requestRaw(`${p(projectId)}/plan`, planReadSchema, opts);
    return { ...data, etag: headers.get("ETag") };
  },
  /** For playback only: storage keys swapped for playable URLs. */
  getResolved: async (projectId: string, opts?: Opts): Promise<PlanResolved> => {
    const { data, headers } = await requestRaw(`${p(projectId)}/plan/resolved`, planResolvedSchema, opts);
    return { ...data, etag: headers.get("ETag") };
  },
  /**
   * Create (no `revision`) or replace the plan. Pass the revision (or ETag) you loaded; the
   * backend answers 412 `revision_mismatch` when someone saved in between.
   */
  save: async (
    projectId: string,
    body: unknown,
    opts?: Opts & { revision?: number | null; etag?: string | null },
  ): Promise<PlanRead> => {
    const revision = opts?.revision ?? revisionFromEtag(opts?.etag);
    const headers: Record<string, string> = revision != null ? { "If-Match": etagForRevision(revision) } : {};
    const { data, headers: resHeaders } = await requestRaw(`${p(projectId)}/plan`, planReadSchema, {
      ...opts,
      method: "PUT",
      body,
      headers,
    });
    return { ...data, etag: resHeaders.get("ETag") ?? etagForRevision(data.revision) };
  },
};

export const api = { projects, uploads, sources, jobs, plan };
export type Api = typeof api;

/** `projects/{pid}/sources/{sid}/proxy-720p.mp4` -> sid (plans store media as storage keys). */
export function sourceIdFromStorageKey(key: string | undefined, projectId: string): string | null {
  if (!key) return null;
  const match = key.match(/projects\/([^/]+)\/sources\/([^/]+)\//);
  return match && match[1] === projectId ? match[2] : null;
}
