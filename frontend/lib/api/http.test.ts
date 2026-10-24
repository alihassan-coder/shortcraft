import { describe, expect, it, vi } from "vitest";
import { ApiError, plan, projects } from "./index";

const json = (status: number, body: unknown, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", ...headers } });

const planBody = { revision: 3, updated_at: "2026-10-24T00:00:00Z", plan: { version: 2, sources: [] } };

describe("api client", () => {
  it("parses backend errors into ApiError", async () => {
    const fetchMock = vi.fn(async () => json(404, { error: { code: "not_found", message: "Project not found" } }));
    const err = await projects.get("x", { fetch: fetchMock }).catch((e) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect(err).toMatchObject({ status: 404, code: "not_found", message: "Project not found" });
  });

  it("maps network failures to network_error", async () => {
    const fetchMock = vi.fn(async () => {
      throw new TypeError("Failed to fetch");
    });
    await expect(projects.list({ fetch: fetchMock })).rejects.toMatchObject({ code: "network_error", status: 0 });
  });

  it("rejects responses that do not match the schema", async () => {
    const fetchMock = vi.fn(async () => json(200, [{ id: 1 }]));
    await expect(projects.list({ fetch: fetchMock })).rejects.toMatchObject({ code: "bad_response" });
  });

  it("reads the plan ETag and sends it back as If-Match", async () => {
    const fetchMock = vi.fn(async (_url: RequestInfo | URL, init?: RequestInit) => {
      void init;
      return json(200, planBody, { ETag: '"3"' });
    });
    const loaded = await plan.get("p1", { fetch: fetchMock });
    expect(loaded.etag).toBe('"3"');

    await plan.save("p1", loaded.plan, { etag: loaded.etag, fetch: fetchMock });
    const init = fetchMock.mock.calls[1][1];
    expect(init?.method).toBe("PUT");
    expect((init?.headers as Record<string, string>)["If-Match"]).toBe('"3"');
  });

  it("creates the first plan without If-Match and surfaces 412", async () => {
    const fetchMock = vi.fn(async (_url: RequestInfo | URL, init?: RequestInit) => {
      const headers = init?.headers as Record<string, string>;
      return headers["If-Match"]
        ? json(412, { error: { code: "revision_mismatch", message: "stale" } })
        : json(200, { ...planBody, revision: 1 });
    });
    expect((await plan.save("p1", {}, { fetch: fetchMock })).etag).toBe('"1"');
    await expect(plan.save("p1", {}, { revision: 1, fetch: fetchMock })).rejects.toMatchObject({ status: 412 });
  });
});
