import { describe, expect, it, vi } from "vitest";
import type { Source, UploadCreated } from "@/lib/api";
import { TransportError, type UploadTransport } from "./transport";
import { uploadFile, UploadError, type UploadApi } from "./upload-file";
import { checkVideoFile } from "./validate";

const MB = 1024 * 1024;

const source = (status: Source["status"] = "pending"): Source => ({
  id: "s1",
  project_id: "p1",
  filename: "talk.mp4",
  content_type: "video/mp4",
  size_bytes: 25 * MB,
  status,
  created_at: "2026-10-24T00:00:00Z",
});

function file(size: number, name = "talk.mp4", type = "video/mp4") {
  return new File([new Uint8Array(size)], name, { type });
}

function multipartApi(size: number, partSize = 10 * MB) {
  const count = Math.ceil(size / partSize);
  const created: UploadCreated = {
    source: source(),
    upload: {
      mode: "multipart",
      uploadId: "u1",
      partSize,
      parts: Array.from({ length: count }, (_, i) => ({ partNumber: i + 1, url: `https://r2/part/${i + 1}` })),
    },
  };
  const api = {
    start: vi.fn(async () => created),
    complete: vi.fn(async () => source("uploaded")),
    abort: vi.fn(async () => source("aborted")),
  };
  return api as typeof api & UploadApi;
}

/** Fake bytes mover: records calls, can fail per URL, resolves on the next microtask. */
function fakeTransport(failures: Record<string, number> = {}, opts: { status?: number } = {}) {
  let inFlight = 0;
  let maxInFlight = 0;
  const calls: { url: string; size: number }[] = [];
  const transport: UploadTransport = {
    async put(url, body, { onProgress, signal }) {
      calls.push({ url, size: body.size });
      inFlight++;
      maxInFlight = Math.max(maxInFlight, inFlight);
      try {
        await new Promise((r) => setTimeout(r, 1));
        if (signal?.aborted) throw new DOMException("x", "AbortError");
        if (failures[url]) {
          failures[url]--;
          throw new TransportError(opts.status ?? 500, "boom");
        }
        onProgress?.(body.size / 2);
        onProgress?.(body.size);
        return { etag: `"etag-${url.split("/").pop()}"` };
      } finally {
        inFlight--;
      }
    },
  };
  return { transport, calls, maxInFlight: () => maxInFlight };
}

const noDelay = async () => {};

describe("uploadFile (multipart)", () => {
  it("uploads every part with at most 3 in flight and completes with ordered ETags", async () => {
    const size = 55 * MB; // 6 parts, the last one 5 MB
    const api = multipartApi(size);
    const fake = fakeTransport();
    const progress: number[] = [];

    const result = await uploadFile("p1", file(size), {
      api,
      transport: fake.transport,
      retryDelay: noDelay,
      onProgress: (p) => progress.push(p.fraction),
    });

    expect(result.mode).toBe("multipart");
    expect(fake.calls).toHaveLength(6);
    expect(fake.maxInFlight()).toBe(3);
    expect(fake.calls.find((c) => c.url.endsWith("/6"))?.size).toBe(5 * MB);
    expect(api.complete).toHaveBeenCalledWith(
      "p1",
      "s1",
      Array.from({ length: 6 }, (_, i) => ({ partNumber: i + 1, etag: `"etag-${i + 1}"` })),
      expect.anything(),
    );
    expect(progress.at(-1)).toBe(1);
    expect(progress.every((v, i) => i === 0 || v >= progress[i - 1])).toBe(true);
    expect(api.abort).not.toHaveBeenCalled();
  });

  it("retries a failing part and still completes", async () => {
    const size = 25 * MB;
    const api = multipartApi(size);
    const fake = fakeTransport({ "https://r2/part/2": 2 });
    const delay = vi.fn(noDelay);

    await uploadFile("p1", file(size), { api, transport: fake.transport, retryDelay: delay });

    expect(fake.calls.filter((c) => c.url.endsWith("/2"))).toHaveLength(3);
    expect(delay).toHaveBeenCalledTimes(2);
    expect(api.complete).toHaveBeenCalledOnce();
  });

  it("gives up after 3 attempts, aborts the upload and never completes", async () => {
    const size = 25 * MB;
    const api = multipartApi(size);
    const fake = fakeTransport({ "https://r2/part/3": 5 });

    await expect(uploadFile("p1", file(size), { api, transport: fake.transport, retryDelay: noDelay })).rejects.toThrow("boom");

    expect(fake.calls.filter((c) => c.url.endsWith("/3"))).toHaveLength(3);
    expect(api.complete).not.toHaveBeenCalled();
    expect(api.abort).toHaveBeenCalledWith("p1", "s1");
  });

  it("does not retry permanent 4xx errors", async () => {
    const api = multipartApi(15 * MB);
    const fake = fakeTransport({ "https://r2/part/1": 5 }, { status: 403 });

    await expect(uploadFile("p1", file(15 * MB), { api, transport: fake.transport, retryDelay: noDelay })).rejects.toThrow();
    expect(fake.calls.filter((c) => c.url.endsWith("/1"))).toHaveLength(1);
  });

  it("cancels: stops sending parts, aborts on the backend and rejects with AbortError", async () => {
    const size = 95 * MB;
    const api = multipartApi(size);
    const fake = fakeTransport();
    const controller = new AbortController();

    const run = uploadFile("p1", file(size), {
      api,
      transport: fake.transport,
      retryDelay: noDelay,
      signal: controller.signal,
      onProgress: (p) => {
        if (p.fraction > 0.2) controller.abort();
      },
    });

    await expect(run).rejects.toMatchObject({ name: "AbortError" });
    expect(fake.calls.length).toBeLessThan(10);
    expect(api.complete).not.toHaveBeenCalled();
    expect(api.abort).toHaveBeenCalledOnce();
  });
});

describe("uploadFile (single)", () => {
  it("PUTs the whole file with the given headers, then completes", async () => {
    const put = vi.fn<UploadTransport["put"]>(async (_url, body, { onProgress }) => {
      onProgress?.(body.size);
      return { etag: null };
    });
    const api = {
      start: vi.fn(async () => ({
        source: source(),
        upload: { mode: "single" as const, method: "PUT" as const, url: "http://api/content", headers: { "Content-Type": "video/mp4" } },
      })),
      complete: vi.fn(async () => source("uploaded")),
      abort: vi.fn(async () => source("aborted")),
    };
    const onSource = vi.fn();

    const result = await uploadFile("p1", file(2 * MB), { api, transport: { put }, onSource, retryDelay: noDelay });

    expect(result.mode).toBe("single");
    expect(onSource).toHaveBeenCalledWith(expect.objectContaining({ id: "s1" }));
    expect(put).toHaveBeenCalledWith("http://api/content", expect.any(Blob), expect.objectContaining({ headers: { "Content-Type": "video/mp4" } }));
    expect(api.start).toHaveBeenCalledWith("p1", { filename: "talk.mp4", content_type: "video/mp4", size_bytes: 2 * MB }, expect.anything());
    expect(api.complete).toHaveBeenCalledWith("p1", "s1", undefined, expect.anything());
  });

  it("rejects unsupported files before calling the API", async () => {
    const api = multipartApi(MB);
    await expect(uploadFile("p1", file(MB, "notes.txt", "text/plain"), { api })).rejects.toBeInstanceOf(UploadError);
    expect(api.start).not.toHaveBeenCalled();
  });
});

describe("checkVideoFile", () => {
  it("accepts the four containers, using the extension when the type is empty", () => {
    expect(checkVideoFile({ name: "a.mkv", size: 1, type: "" })).toEqual({ ok: true, contentType: "video/x-matroska" });
    expect(checkVideoFile({ name: "a.MOV", size: 1, type: "" })).toEqual({ ok: true, contentType: "video/quicktime" });
    expect(checkVideoFile({ name: "a.webm", size: 1, type: "video/webm" })).toEqual({ ok: true, contentType: "video/webm" });
  });

  it("rejects other types and files over 2 GB", () => {
    expect(checkVideoFile({ name: "a.avi", size: 1, type: "video/x-msvideo" }).ok).toBe(false);
    expect(checkVideoFile({ name: "a.mp4", size: 2 * 1024 ** 3 + 1, type: "video/mp4" })).toMatchObject({ ok: false });
  });
});
