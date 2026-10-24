import { z } from "zod";

// Response shapes of the FastAPI backend (backend/app/schemas). Only the fields the app reads
// are strict; unknown keys are dropped so additive backend changes never break the client.

const isoDate = z.string();

export const projectSchema = z.object({
  id: z.string(),
  title: z.string(),
  owner_id: z.string().nullable().optional(),
  created_at: isoDate,
  updated_at: isoDate,
});
export type Project = z.infer<typeof projectSchema>;

export const jobStatusSchema = z.enum(["queued", "running", "succeeded", "failed"]);
export type JobStatus = z.infer<typeof jobStatusSchema>;

export const jobKindSchema = z.enum(["proxy", "transcribe", "plan", "render"]);
export type JobKind = z.infer<typeof jobKindSchema>;

export const jobSchema = z.object({
  id: z.string(),
  project_id: z.string(),
  kind: jobKindSchema,
  source_id: z.string().nullable().optional(),
  params: z.record(z.string(), z.unknown()).nullable().optional(),
  status: jobStatusSchema,
  progress: z.number().default(0),
  error: z.string().nullable(),
  result: z.record(z.string(), z.unknown()).nullable(),
  started_at: isoDate.nullable().optional(),
  finished_at: isoDate.nullable().optional(),
  created_at: isoDate,
  updated_at: isoDate,
});
export type Job = z.infer<typeof jobSchema>;

export const sourceStatusSchema = z.enum(["pending", "uploaded", "processing", "ready", "failed", "aborted"]);
export type SourceStatus = z.infer<typeof sourceStatusSchema>;

export const sourceSchema = z.object({
  id: z.string(),
  project_id: z.string(),
  filename: z.string(),
  content_type: z.string(),
  size_bytes: z.number(),
  status: sourceStatusSchema,
  width: z.number().nullable().optional(),
  height: z.number().nullable().optional(),
  duration_ms: z.number().nullable().optional(),
  fps: z.number().nullable().optional(),
  video_codec: z.string().nullable().optional(),
  audio_codec: z.string().nullable().optional(),
  transcript_language: z.string().nullable().optional(),
  transcript_word_count: z.number().nullable().optional(),
  created_at: isoDate,
});
export type Source = z.infer<typeof sourceSchema>;

const sourceUrlSchema = z.object({ url: z.string(), expires_in: z.number().nullable().optional() }).nullable();
export type SourceUrl = z.infer<typeof sourceUrlSchema>;

export const sourceDetailSchema = sourceSchema.extend({
  urls: z.object({
    original: sourceUrlSchema.optional(),
    proxy: sourceUrlSchema.optional(),
    audio: sourceUrlSchema.optional(),
    sprite: sourceUrlSchema.optional(),
    sprite_index: sourceUrlSchema.optional(),
    peaks: sourceUrlSchema.optional(),
    transcript: sourceUrlSchema.optional(),
  }),
  proxy_job: jobSchema.nullable().optional(),
});
export type SourceDetail = z.infer<typeof sourceDetailSchema>;

export const singleUploadSchema = z.object({
  mode: z.literal("single"),
  method: z.literal("PUT"),
  url: z.string(),
  headers: z.record(z.string(), z.string()).default({}),
});
export const multipartUploadSchema = z.object({
  mode: z.literal("multipart"),
  uploadId: z.string(),
  partSize: z.number().int().positive(),
  parts: z.array(z.object({ partNumber: z.number().int().positive(), url: z.string() })),
});
export const uploadTargetSchema = z.discriminatedUnion("mode", [singleUploadSchema, multipartUploadSchema]);
export type SingleUploadTarget = z.infer<typeof singleUploadSchema>;
export type MultipartUploadTarget = z.infer<typeof multipartUploadSchema>;
export type UploadTarget = z.infer<typeof uploadTargetSchema>;

export const uploadCreatedSchema = z.object({ source: sourceSchema, upload: uploadTargetSchema });
export type UploadCreated = z.infer<typeof uploadCreatedSchema>;

export type CompletedPart = { partNumber: number; etag: string };

// The edit plan body is owned by lib/edit-plan (Zod EditPlan v2). The client only reads the
// parts it needs here (media sources) and passes the rest through untouched.
export const planBodySchema = z.looseObject({
  version: z.number().optional(),
  sources: z
    .array(z.looseObject({ id: z.string().optional(), src: z.string().optional(), poster: z.string().optional() }))
    .optional(),
});
export type PlanBody = z.infer<typeof planBodySchema>;

export const planReadSchema = z.object({
  revision: z.number().int(),
  updated_at: isoDate,
  plan: planBodySchema,
});
export const planResolvedSchema = planReadSchema.extend({ expires_in: z.number().nullable().optional() });
export type PlanRead = z.infer<typeof planReadSchema> & { etag: string | null };
export type PlanResolved = z.infer<typeof planResolvedSchema> & { etag: string | null };

export const spriteIndexSchema = z.object({
  interval_s: z.number().optional(),
  width: z.number(),
  height: z.number(),
  columns: z.number(),
  rows: z.number(),
  count: z.number(),
  frames: z.array(z.object({ t: z.number(), x: z.number(), y: z.number() })),
});
export type SpriteIndex = z.infer<typeof spriteIndexSchema>;

export const errorBodySchema = z.object({
  error: z.object({ code: z.string(), message: z.string(), details: z.unknown().optional() }),
});
