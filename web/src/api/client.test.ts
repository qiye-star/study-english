import { describe, expect, it, vi } from "vitest";
import { createFetchMock, json } from "~/test/fetch-mock";
import { ApiClient, ApiError } from "./client";

const make = (routes: Parameters<typeof createFetchMock>[0], extra: Partial<ConstructorParameters<typeof ApiClient>[0]> = {}) => {
  const mock = createFetchMock(routes);
  const api = new ApiClient({ getToken: () => "tok", fetchImpl: mock.fetch, ...extra });
  return { api, mock };
};

describe("ApiClient", () => {
  it("sends bearer token, snake_case JSON and returns camelCase", async () => {
    const { api, mock } = make({ "POST /api/conversations": () => json({ id: "c1", created_at: "t", config: { tts_voice: "alloy" } }) });
    const res = await api.request<any>("POST", "/api/conversations", { json: { name: "n", config: { ttsVoice: "alloy" } } });
    expect(res).toEqual({ id: "c1", createdAt: "t", config: { ttsVoice: "alloy" } });
    const call = mock.calls[0];
    expect(call.headers.get("Authorization")).toBe("Bearer tok");
    expect(call.headers.get("Content-Type")).toBe("application/json");
    expect(JSON.parse(call.body as string)).toEqual({ name: "n", config: { tts_voice: "alloy" } });
  });

  it("omits Authorization for auth:false and when there is no token", async () => {
    const { api, mock } = make({ "GET /api/config/x": () => json({}) });
    await api.request("GET", "/api/config/x", { auth: false });
    expect(mock.calls[0].headers.has("Authorization")).toBe(false);
    const anon = make({ "GET /api/me": () => json({}) }, { getToken: () => null });
    await anon.api.request("GET", "/api/me");
    expect(anon.mock.calls[0].headers.has("Authorization")).toBe(false);
  });

  it("builds the query string and skips undefined values", async () => {
    const { api, mock } = make({ "GET /api/assessments": () => json({ assessments: [] }) });
    await api.request("GET", "/api/assessments", { query: { page: 2, per_page: 20, q: undefined } });
    expect(mock.calls[0].url.search).toBe("?page=2&per_page=20");
  });

  it("sends FormData untouched and lets the browser set the boundary", async () => {
    const { api, mock } = make({ "POST /api/upload": () => json({}) });
    const form = new FormData();
    form.append("reference", "Hello");
    await api.request("POST", "/api/upload", { form });
    expect(mock.calls[0].body).toBe(form);
    expect(mock.calls[0].headers.has("Content-Type")).toBe(false);
  });

  it("throws ApiError carrying the server message", async () => {
    const { api } = make({ "POST /api/sessions": () => json({ error: "Invalid username or password" }, 401) });
    await expect(api.request("POST", "/api/sessions", { json: {}, auth: false })).rejects.toMatchObject({
      name: "ApiError", status: 401, message: "Invalid username or password",
    });
  });

  it("uses HTTP status when the error body is not JSON", async () => {
    const { api } = make({ "GET /x": () => new Response("<html>", { status: 502 }) });
    await expect(api.request("GET", "/x")).rejects.toMatchObject({ status: 502, message: "HTTP 502" });
  });

  it("calls onUnauthorized for authenticated 401 only", async () => {
    const onUnauthorized = vi.fn();
    const { api } = make(
      { "GET /api/me": () => json({ error: "Unauthorized" }, 401), "POST /api/sessions": () => json({ error: "Invalid username or password" }, 401) },
      { onUnauthorized },
    );
    await expect(api.me()).rejects.toBeInstanceOf(ApiError);
    expect(onUnauthorized).toHaveBeenCalledTimes(1);
    await expect(api.login("a", "b")).rejects.toBeInstanceOf(ApiError);
    expect(onUnauthorized).toHaveBeenCalledTimes(1);
  });

  it("maps network failures and timeouts", async () => {
    const failing = new ApiClient({ getToken: () => null, fetchImpl: (async () => { throw new TypeError("Failed to fetch"); }) as typeof fetch });
    await expect(failing.request("GET", "/x")).rejects.toMatchObject({ status: 0, message: "Network error" });
    const { api } = make({
      "GET /slow": (call) => new Promise((_, reject) => call.signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")))),
    });
    await expect(api.request("GET", "/slow", { timeoutMs: 20 })).rejects.toMatchObject({ status: 0, message: "Request timed out" });
  });

  it("returns blobs and raw responses", async () => {
    const { api } = make({
      "GET /audio": () => new Response(new Uint8Array([1, 2, 3]), { headers: { "Content-Type": "audio/wav" } }),
      "POST /stream": () => new Response("data: x\n\n", { headers: { "Content-Type": "text/event-stream" } }),
    });
    const blob = await api.request<Blob>("GET", "/audio", { as: "blob" });
    expect(blob.size).toBe(3);
    const raw = await api.request<Response>("POST", "/stream", { as: "raw", json: {} });
    expect(await raw.text()).toBe("data: x\n\n");
  });

  it("auth helpers hit the documented endpoints", async () => {
    const user = { id: "12345678", name: "alice", created_at: "t", access_token: "new" };
    const { api, mock } = make({
      "POST /api/sessions": () => json(user),
      "POST /api/users": () => json(user),
      "GET /api/me": () => json({ id: "12345678", name: "alice", created_at: "t" }),
      "GET /api/config/tts_providers_v2": () => json({ enjoyai: { models: ["openai/tts-1"] } }),
    });
    expect(await api.login("alice", "pw")).toEqual({ id: "12345678", name: "alice", createdAt: "t", accessToken: "new" });
    expect(JSON.parse(mock.calls[0].body as string)).toEqual({ provider: "password", username: "alice", password: "pw" });
    await api.register("bob", "password1", "inv");
    expect(JSON.parse(mock.calls[1].body as string)).toEqual({ username: "bob", password: "password1", invite_code: "inv" });
    await api.register("carol", "password1");
    expect(JSON.parse(mock.calls[2].body as string)).toEqual({ username: "carol", password: "password1" });
    expect((await api.me()).name).toBe("alice");
    expect(await api.getConfig("tts_providers_v2")).toEqual({ enjoyai: { models: ["openai/tts-1"] } });
    expect(mock.calls[4].headers.has("Authorization")).toBe(false);
  });
});
