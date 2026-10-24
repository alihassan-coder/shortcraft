import { uploads as uploadsApi, type CompletedPart, type MultipartUploadTarget, type Source } from "@/lib/api";
import { abortError, isAbortError, TransportError, xhrTransport, type UploadTransport } from "./transport";
import { checkVideoFile } from "./validate";

export type UploadProgress = { loaded: number; total: number; fraction: number };

/** The API calls the upload needs (injectable for tests). */
export type UploadApi = {
  start: typeof uploadsApi.start;
  complete: typeof uploadsApi.complete;
  abort: typeof uploadsApi.abort;
};

export type UploadOptions = {
  onProgress?: (progress: UploadProgress) => void;
  /** Called as soon as the backend created the source (before any byte is sent). */
  onSource?: (source: Source) => void;
  signal?: AbortSignal;
  transport?: UploadTransport;
  api?: UploadApi;
  /** Parts in flight at once (multipart). */
  concurrency?: number;
  /** Tries per part, including the first one. */
  maxAttempts?: number;
  /** Wait before retry N (1-based). Injectable so tests don't sleep. */
  retryDelay?: (attempt: number, signal?: AbortSignal) => Promise<void>;
};

export type UploadResult = { source: Source; mode: "single" | "multipart" };

export class UploadError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UploadError";
  }
}

const defaultDelay = (attempt: number, signal?: AbortSignal) =>
  new Promise<void>((resolve, reject) => {
    const timer = setTimeout(resolve, 400 * 2 ** (attempt - 1));
    signal?.addEventListener(
      "abort",
      () => {
        clearTimeout(timer);
        reject(abortError());
      },
      { once: true },
    );
  });

/**
 * Upload a video to a project: start -> PUT (single, or parallel parts with retries) ->
 * complete (which starts the proxy -> transcribe -> plan chain on the backend).
 * Cancelling via `signal` stops every request and aborts the upload on the backend.
 */
export async function uploadFile(projectId: string, file: File | Blob, options: UploadOptions = {}): Promise<UploadResult> {
  const {
    onProgress,
    onSource,
    signal,
    transport = xhrTransport,
    api = uploadsApi,
    concurrency = 3,
    maxAttempts = 3,
    retryDelay = defaultDelay,
  } = options;

  const name = "name" in file ? file.name : "video.mp4";
  const check = checkVideoFile({ name, size: file.size, type: file.type });
  if (!check.ok) throw new UploadError(check.reason);
  if (signal?.aborted) throw abortError();

  const { source, upload } = await api.start(
    projectId,
    { filename: name, content_type: check.contentType, size_bytes: file.size },
    { signal },
  );
  onSource?.(source);

  const total = file.size;
  const report = (loaded: number) => onProgress?.({ loaded, total, fraction: total ? Math.min(1, loaded / total) : 1 });
  report(0);

  try {
    if (upload.mode === "single") {
      await withRetries(() => transport.put(upload.url, file, { headers: upload.headers, onProgress: report, signal }), {
        maxAttempts,
        retryDelay,
        signal,
      });
      const done = await api.complete(projectId, source.id, undefined, { signal });
      report(total);
      return { source: done, mode: "single" };
    }

    const parts = await uploadParts(file, upload, { transport, concurrency, maxAttempts, retryDelay, signal, report });
    const done = await api.complete(projectId, source.id, parts, { signal });
    report(total);
    return { source: done, mode: "multipart" };
  } catch (err) {
    // Leave nothing half-uploaded behind (best effort; the backend also expires them).
    await api.abort(projectId, source.id).catch(() => undefined);
    if (signal?.aborted || isAbortError(err)) throw abortError();
    throw err;
  }
}

async function withRetries<T>(
  run: () => Promise<T>,
  { maxAttempts, retryDelay, signal }: { maxAttempts: number; retryDelay: NonNullable<UploadOptions["retryDelay"]>; signal?: AbortSignal },
): Promise<T> {
  for (let attempt = 1; ; attempt++) {
    try {
      return await run();
    } catch (err) {
      if (signal?.aborted || isAbortError(err)) throw err;
      // 4xx other than timeouts/throttling will not get better on retry.
      const permanent = err instanceof TransportError && err.status >= 400 && err.status < 500 && ![408, 429].includes(err.status);
      if (permanent || attempt >= maxAttempts) throw err;
      await retryDelay(attempt, signal);
    }
  }
}

async function uploadParts(
  file: Blob,
  target: MultipartUploadTarget,
  opts: {
    transport: UploadTransport;
    concurrency: number;
    maxAttempts: number;
    retryDelay: NonNullable<UploadOptions["retryDelay"]>;
    signal?: AbortSignal;
    report: (loaded: number) => void;
  },
): Promise<CompletedPart[]> {
  const { transport, concurrency, maxAttempts, retryDelay, signal, report } = opts;
  const parts = [...target.parts].sort((a, b) => a.partNumber - b.partNumber);
  const loaded = new Map<number, number>();
  const sum = () => [...loaded.values()].reduce((a, b) => a + b, 0);
  const results: CompletedPart[] = [];

  // One controller for every part: the first fatal error cancels the parts still running.
  const inner = new AbortController();
  const forward = () => inner.abort();
  signal?.addEventListener("abort", forward, { once: true });

  let next = 0;
  const worker = async () => {
    while (next < parts.length) {
      const part = parts[next++];
      const start = (part.partNumber - 1) * target.partSize;
      const chunk = file.slice(start, Math.min(start + target.partSize, file.size));
      const { etag } = await withRetries(
        () => {
          loaded.set(part.partNumber, 0);
          return transport.put(part.url, chunk, {
            signal: inner.signal,
            onProgress: (n) => {
              loaded.set(part.partNumber, Math.min(n, chunk.size));
              report(sum());
            },
          });
        },
        { maxAttempts, retryDelay, signal: inner.signal },
      );
      if (!etag) throw new UploadError("The storage did not return an ETag for a part (check the bucket CORS).");
      loaded.set(part.partNumber, chunk.size);
      report(sum());
      results.push({ partNumber: part.partNumber, etag });
    }
  };

  try {
    const workers = Array.from({ length: Math.max(1, Math.min(concurrency, parts.length)) }, worker);
    const settled = await Promise.allSettled(workers.map((w) => w.catch((err) => {
      inner.abort();
      throw err;
    })));
    const failure = settled.find((r): r is PromiseRejectedResult => r.status === "rejected");
    if (failure) {
      // Prefer the real cause over the AbortErrors it caused in sibling parts.
      const real = settled.find(
        (r): r is PromiseRejectedResult => r.status === "rejected" && !isAbortError(r.reason),
      );
      throw (real ?? failure).reason;
    }
  } finally {
    signal?.removeEventListener("abort", forward);
  }
  return results.sort((a, b) => a.partNumber - b.partNumber);
}
