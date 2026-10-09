import { describe, expect, it, vi } from "vitest";
import { ApiError, createClient } from "./client";

const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

function setup(response: Response | (() => Promise<Response>), csrf: string | null = "c1") {
  const fetchImpl = vi.fn(typeof response === "function" ? response : async () => response);
  const onUnauthorized = vi.fn();
  const onStepUp = vi.fn().mockResolvedValue(false);
  const request = createClient({ getCsrf: () => csrf, onUnauthorized, onStepUp, fetchImpl: fetchImpl as unknown as typeof fetch });
  return { fetchImpl, onUnauthorized, onStepUp, request };
}

const initOf = (fetchImpl: ReturnType<typeof vi.fn>, call = 0) => fetchImpl.mock.calls[call][1] as RequestInit & { headers: Record<string, string> };

describe("client v2", () => {
  it("sends cookies, CSRF on unsafe methods only, and no Authorization header", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(json(200, { ok: true }));
    const request = createClient({ getCsrf: () => "c1", onUnauthorized: vi.fn(), onStepUp: vi.fn(), fetchImpl });
    await request("/api/admin/overview");
    fetchImpl.mockResolvedValue(json(200, { ok: true }));
    await request("/api/admin/settings", { method: "PATCH", json: { a: 1 } });
    const getInit = initOf(fetchImpl, 0);
    const patchInit = initOf(fetchImpl, 1);
    expect(getInit.credentials).toBe("same-origin");
    expect(getInit.headers["X-Admin-CSRF"]).toBeUndefined();
    expect(patchInit.headers["X-Admin-CSRF"]).toBe("c1");
    expect(patchInit.method).toBe("PATCH");
    expect(JSON.stringify(patchInit.headers)).not.toContain("Authorization");
    expect(JSON.stringify(getInit.headers)).not.toContain("Authorization");
  });

  it("replays once after a successful step-up", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(json(403, { error: "Step-up required" }))
      .mockResolvedValueOnce(json(200, { done: true }));
    const onStepUp = vi.fn().mockResolvedValue(true);
    const request = createClient({ getCsrf: () => "c", onUnauthorized: vi.fn(), onStepUp, fetchImpl });
    await expect(request("/api/admin/x", { method: "POST", json: {} })).resolves.toEqual({ done: true });
    expect(onStepUp).toHaveBeenCalledTimes(1);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("does not loop when step-up is cancelled or the replay asks again", async () => {
    const cancelled = setup(json(403, { error: "Step-up required" }));
    await expect(cancelled.request("/x", { method: "POST" })).rejects.toMatchObject({ status: 403, message: "Step-up required" });
    expect(cancelled.fetchImpl).toHaveBeenCalledTimes(1);

    const fetchImpl = vi.fn(async () => json(403, { error: "Step-up required" }));
    const onStepUp = vi.fn().mockResolvedValue(true);
    const request = createClient({ getCsrf: () => "c", onUnauthorized: vi.fn(), onStepUp, fetchImpl: fetchImpl as unknown as typeof fetch });
    await expect(request("/x", { method: "DELETE" })).rejects.toBeInstanceOf(ApiError);
    expect(onStepUp).toHaveBeenCalledTimes(1);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("surfaces field errors and logs out on 401", async () => {
    const onUnauthorized = vi.fn();
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(json(422, { error: "Invalid settings", fields: { rate_limit_per_minute: "must be between 1 and 10000" } }))
      .mockResolvedValueOnce(json(401, { error: "Unauthorized" }));
    const request = createClient({ getCsrf: () => "c", onUnauthorized, onStepUp: vi.fn(), fetchImpl });
    const err = (await request("/a", { method: "PATCH", json: {} }).catch((e) => e)) as ApiError;
    expect(err).toBeInstanceOf(ApiError);
    expect(err.fields).toEqual({ rate_limit_per_minute: "must be between 1 and 10000" });
    await request("/b").catch(() => undefined);
    expect(onUnauthorized).toHaveBeenCalled();
  });

  it("builds the query string, dropping empty values", async () => {
    const { fetchImpl, request } = setup(json(200, { ok: true }));
    await request("/api/admin/users", { query: { q: "", page: 2, per_page: 20, source: undefined } });
    expect((fetchImpl.mock.calls[0] as unknown as [string])[0]).toBe("/api/admin/users?page=2&per_page=20");
  });

  it("does not treat a 401 from a login call (auth: false) as an expired session", async () => {
    const { fetchImpl, onUnauthorized, request } = setup(json(401, { error: "Invalid username or password" }));
    await expect(request("/api/admin/login", { json: { username: "a", password: "b" }, auth: false })).rejects.toMatchObject({
      status: 401,
      message: "Invalid username or password",
    });
    const init = initOf(fetchImpl);
    expect(init.method).toBe("POST");
    expect(init.body).toBe(JSON.stringify({ username: "a", password: "b" }));
    expect(onUnauthorized).not.toHaveBeenCalled();
  });

  it("falls back to a generic message for non-JSON error bodies", async () => {
    const b = setup(new Response("<html>bad gateway</html>", { status: 502 }));
    await expect(b.request("/x")).rejects.toMatchObject({ status: 502, message: "请求失败(502)" });
    expect(b.onUnauthorized).not.toHaveBeenCalled();
  });

  it("maps network failures to a friendly ApiError", async () => {
    const { request } = setup(async () => {
      throw new TypeError("Failed to fetch");
    });
    await expect(request("/x")).rejects.toMatchObject({ status: 0 });
  });

  it("returns a blob when asked and undefined for 204", async () => {
    const a = setup(new Response(new Uint8Array([82, 73, 70, 70]), { headers: { "Content-Type": "audio/wav" } }));
    expect((await a.request<Blob>("/audio", { as: "blob" })).size).toBe(4);
    const b = setup(new Response(null, { status: 204 }));
    await expect(b.request("/api/admin/logout", { method: "POST" })).resolves.toBeUndefined();
  });
});
