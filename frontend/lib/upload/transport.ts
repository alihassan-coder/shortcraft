/** Moves bytes to a URL. The real one is XHR (fetch has no upload progress); tests use a fake. */
export type PutResult = { etag: string | null };

export type UploadTransport = {
  put(
    url: string,
    body: Blob,
    options: { headers?: Record<string, string>; onProgress?: (loaded: number) => void; signal?: AbortSignal },
  ): Promise<PutResult>;
};

export class TransportError extends Error {
  readonly status: number;
  constructor(status: number, message: string) {
    super(message);
    this.name = "TransportError";
    this.status = status;
  }
}

export function abortError(): DOMException {
  return new DOMException("Upload cancelled", "AbortError");
}

export function isAbortError(err: unknown): boolean {
  return err instanceof DOMException && err.name === "AbortError";
}

export const xhrTransport: UploadTransport = {
  put(url, body, { headers = {}, onProgress, signal } = {}) {
    return new Promise<PutResult>((resolve, reject) => {
      if (signal?.aborted) return reject(abortError());
      const xhr = new XMLHttpRequest();
      xhr.open("PUT", url);
      for (const [name, value] of Object.entries(headers)) xhr.setRequestHeader(name, value);
      xhr.upload.onprogress = (e) => onProgress?.(e.loaded);
      const onAbort = () => xhr.abort();
      signal?.addEventListener("abort", onAbort, { once: true });
      const done = () => signal?.removeEventListener("abort", onAbort);
      xhr.onload = () => {
        done();
        if (xhr.status >= 200 && xhr.status < 300) {
          onProgress?.(body.size);
          resolve({ etag: xhr.getResponseHeader("ETag") });
        } else {
          let message = `Upload failed (${xhr.status}).`;
          try {
            const parsed = JSON.parse(xhr.responseText) as { error?: { message?: string } };
            if (parsed?.error?.message) message = parsed.error.message;
          } catch {
            // Not JSON (R2 answers with XML).
          }
          reject(new TransportError(xhr.status, message));
        }
      };
      xhr.onerror = () => {
        done();
        reject(new TransportError(0, "The connection dropped during the upload."));
      };
      xhr.onabort = () => {
        done();
        reject(abortError());
      };
      xhr.send(body);
    });
  },
};
