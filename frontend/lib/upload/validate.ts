export const MAX_UPLOAD_BYTES = 2 * 1024 ** 3; // 2 GiB, same as the backend default

// Extension -> the content type the backend accepts.
const TYPES: Record<string, string> = {
  mp4: "video/mp4",
  m4v: "video/mp4",
  mov: "video/quicktime",
  webm: "video/webm",
  mkv: "video/x-matroska",
};
const ALLOWED = new Set(Object.values(TYPES));

export const ACCEPT_ATTR = "video/mp4,video/quicktime,video/webm,video/x-matroska,.mp4,.mov,.webm,.mkv,.m4v";

export type FileCheck = { ok: true; contentType: string } | { ok: false; reason: string };

/** Browsers often leave `file.type` empty for .mkv (and sometimes .mov), so fall back to the
 * extension. */
export function checkVideoFile(file: { name: string; size: number; type: string }): FileCheck {
  const ext = file.name.split(".").pop()?.toLowerCase() ?? "";
  const declared = file.type.split(";")[0].trim().toLowerCase();
  const contentType = ALLOWED.has(declared) ? declared : TYPES[ext];
  if (!contentType) return { ok: false, reason: "Use an MP4, MOV, WebM or MKV video." };
  if (file.size <= 0) return { ok: false, reason: "This file is empty." };
  if (file.size > MAX_UPLOAD_BYTES) return { ok: false, reason: "Videos can be up to 2 GB." };
  return { ok: true, contentType };
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  if (bytes < 1024 ** 3) return `${(bytes / 1024 ** 2).toFixed(bytes < 10 * 1024 ** 2 ? 1 : 0)} MB`;
  return `${(bytes / 1024 ** 3).toFixed(2)} GB`;
}

export function formatDuration(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return "--:--";
  const s = Math.round(seconds);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}
