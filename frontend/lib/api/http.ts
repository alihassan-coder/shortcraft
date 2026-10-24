import type { z } from "zod";
import { errorBodySchema } from "./schemas";

export const DEFAULT_API_URL = "http://localhost:8000";

export function apiBaseUrl(): string {
  const fromEnv = process.env.NEXT_PUBLIC_API_URL;
  return (fromEnv && fromEnv.trim() ? fromEnv.trim() : DEFAULT_API_URL).replace(/\/+$/, "");
}

/** Every failure of the client: HTTP errors (backend `{error: {code, message}}`), network
 * failures (`status: 0`, code `network_error`), aborts (`aborted`) and bad responses. */
export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly details?: unknown;

  constructor(status: number, code: string, message: string, details?: unknown) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
    this.details = details;
  }

  get isNetwork() {
    return this.code === "network_error";
  }
  get isNotFound() {
    return this.status === 404;
  }
  get isAborted() {
    return this.code === "aborted";
  }
}

export function isApiError(value: unknown): value is ApiError {
  return value instanceof ApiError;
}

const STATUS_MESSAGES: Record<number, string> = {
  404: "Not found.",
  412: "Someone saved a newer version.",
  413: "This file is too large.",
  422: "The request was not valid.",
  428: "A revision is required to save.",
  500: "The server had a problem.",
  502: "The storage service had a problem.",
  503: "The service is not ready.",
};

async function toApiError(res: Response): Promise<ApiError> {
  let body: unknown = null;
  try {
    body = await res.json();
  } catch {
    // Not JSON (proxy error page, empty body).
  }
  const parsed = errorBodySchema.safeParse(body);
  if (parsed.success) {
    const { code, message, details } = parsed.data.error;
    return new ApiError(res.status, code, message, details);
  }
  return new ApiError(res.status, `http_${res.status}`, STATUS_MESSAGES[res.status] ?? `Request failed (${res.status}).`);
}

export type RequestOptions = {
  method?: "GET" | "POST" | "PATCH" | "PUT" | "DELETE";
  body?: unknown;
  headers?: Record<string, string>;
  signal?: AbortSignal;
  fetch?: typeof fetch;
};

export type RawResult<T> = { data: T; headers: Headers; status: number };

/** fetch + JSON + Zod. `schema: null` means no body is expected (204). */
export async function requestRaw<S extends z.ZodType>(
  path: string,
  schema: S | null,
  { method = "GET", body, headers, signal, fetch: fetchImpl = fetch }: RequestOptions = {},
): Promise<RawResult<z.infer<S>>> {
  const init: RequestInit = { method, signal, headers: { Accept: "application/json", ...headers } };
  if (body !== undefined) {
    init.body = JSON.stringify(body);
    (init.headers as Record<string, string>)["Content-Type"] = "application/json";
  }

  let res: Response;
  try {
    res = await fetchImpl(`${apiBaseUrl()}/api/v1${path}`, init);
  } catch (err) {
    if (signal?.aborted || (err instanceof DOMException && err.name === "AbortError")) {
      throw new ApiError(0, "aborted", "The request was cancelled.");
    }
    throw new ApiError(0, "network_error", "Can't reach the Shortcraft server.");
  }

  if (!res.ok) throw await toApiError(res);
  if (schema === null || res.status === 204) {
    return { data: undefined as z.infer<S>, headers: res.headers, status: res.status };
  }

  let json: unknown;
  try {
    json = await res.json();
  } catch {
    throw new ApiError(res.status, "bad_response", "The server sent an unreadable response.");
  }
  const parsed = schema.safeParse(json);
  if (!parsed.success) {
    throw new ApiError(res.status, "bad_response", "The server sent an unexpected response.", parsed.error.issues);
  }
  return { data: parsed.data, headers: res.headers, status: res.status };
}

export async function request<S extends z.ZodType>(path: string, schema: S | null, options?: RequestOptions) {
  return (await requestRaw(path, schema, options)).data;
}

/** `"3"` / `W/"3"` -> 3. */
export function revisionFromEtag(etag: string | null | undefined): number | null {
  if (!etag) return null;
  const raw = etag.trim().replace(/^W\//, "").replace(/"/g, "");
  return /^\d+$/.test(raw) ? Number(raw) : null;
}

export function etagForRevision(revision: number): string {
  return `"${revision}"`;
}
