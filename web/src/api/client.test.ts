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

  it("uploads an avatar as multipart with the bearer token and no JSON content type", async () => {
    const { api, mock } = make({
      "POST /api/me/avatar": () => json({ avatar_url: "/api/avatars/00000000000000000000000000000000" }),
      "DELETE /api/me/avatar": () => new Response(null, { status: 204 }),
    });
    const form = new FormData();
    form.append("file", new Blob(["x"], { type: "image/jpeg" }), "avatar.jpg");
    expect(await api.request("POST", "/api/me/avatar", { form })).toEqual({ avatarUrl: "/api/avatars/00000000000000000000000000000000" });
    expect(mock.calls[0].headers.get("Authorization")).toBe("Bearer tok");
    expect(mock.calls[0].headers.has("Content-Type")).toBe(false);
    expect(mock.calls[0].body).toBe(form);
    expect(await api.request("DELETE", "/api/me/avatar")).toEqual({});
    expect(mock.calls[1].method).toBe("DELETE");
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

  it("signs out on an authenticated 403 Account disabled, but not on other 403s", async () => {
    const onUnauthorized = vi.fn();
    const { api } = make(
      {
        "GET /api/me": () => json({ error: "Account disabled" }, 403),
        "GET /api/other": () => json({ error: "Forbidden" }, 403),
      },
      { onUnauthorized },
    );
    await expect(api.request("GET", "/api/other")).rejects.toMatchObject({ status: 403 });
    expect(onUnauthorized).not.toHaveBeenCalled();
    await expect(api.request("GET", "/api/me")).rejects.toMatchObject({ status: 403, message: "Account disabled" });
    expect(onUnauthorized).toHaveBeenCalledTimes(1);
  });

  it("reports a 503 Maintenance so the app can show the maintenance state at once", async () => {
    const onMaintenance = vi.fn();
    const { api } = make(
      { "GET /api/a": () => json({ error: "Maintenance" }, 503), "GET /api/b": () => json({ error: "Upstream down" }, 503) },
      { onMaintenance },
    );
    await expect(api.request("GET", "/api/b")).rejects.toMatchObject({ status: 503 });
    expect(onMaintenance).not.toHaveBeenCalled();
    await expect(api.request("GET", "/api/a")).rejects.toMatchObject({ status: 503, message: "Maintenance" });
    expect(onMaintenance).toHaveBeenCalledTimes(1);
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
    await api.register({ username: "bob", password: "password1", inviteCode: "inv" });
    expect(JSON.parse(mock.calls[1].body as string)).toEqual({ username: "bob", password: "password1", invite_code: "inv" });
    await api.register({ username: "carol", password: "password1" });
    expect(JSON.parse(mock.calls[2].body as string)).toEqual({ username: "carol", password: "password1" });
    expect((await api.me()).name).toBe("alice");
    expect(await api.getConfig("tts_providers_v2")).toEqual({ enjoyai: { models: ["openai/tts-1"] } });
    expect(mock.calls[4].headers.has("Authorization")).toBe(false);
  });

  it("logout deletes the current server session with the bearer token and accepts an empty 204", async () => {
    const { api, mock } = make({ "DELETE /api/sessions/current": () => new Response(null, { status: 204 }) });
    await expect(api.logout()).resolves.toBeUndefined();
    expect(mock.calls[0].method).toBe("DELETE");
    expect(mock.calls[0].url.pathname).toBe("/api/sessions/current");
    expect(mock.calls[0].headers.get("Authorization")).toBe("Bearer tok");
  });

  it("changePassword posts snake_case keys and returns the rotated access token", async () => {
    const { api, mock } = make({ "POST /api/me/password": () => json({ access_token: "rotated" }) });
    const res = await api.changePassword("old-password", "new-password1");
    expect(res).toEqual({ accessToken: "rotated" });
    expect(mock.calls[0].method).toBe("POST");
    expect(JSON.parse(mock.calls[0].body as string)).toEqual({ current_password: "old-password", new_password: "new-password1" });
  });

  it("updateMe patches the nickname (null clears it) and returns the profile", async () => {
    const { api, mock } = make({
      "PATCH /api/me": () => json({ id: "12345678", name: "alice", created_at: "t", nickname: "小明", display_name: "小明" }),
    });
    const me = await api.updateMe({ nickname: "小明" });
    expect(me).toEqual({ id: "12345678", name: "alice", createdAt: "t", nickname: "小明", displayName: "小明" });
    expect(mock.calls[0].method).toBe("PATCH");
    expect(JSON.parse(mock.calls[0].body as string)).toEqual({ nickname: "小明" });
    await api.updateMe({ nickname: null });
    expect(JSON.parse(mock.calls[1].body as string)).toEqual({ nickname: null });
  });

  it("me() tolerates a response without nickname or display_name (fields are optional)", async () => {
    const { api } = make({ "GET /api/me": () => json({ id: "12345678", name: "alice", created_at: "t" }) });
    const me = await api.me();
    expect(me.nickname).toBeUndefined();
    expect(me.displayName).toBeUndefined();
    expect(me.name).toBe("alice");
  });

  it("a 403 email_binding_required calls onBindingRequired once and not onUnauthorized", async () => {
    const onUnauthorized = vi.fn();
    const onBindingRequired = vi.fn();
    const { api } = make(
      { "GET /api/conversations": () => json({ error: "email_binding_required" }, 403) },
      { onUnauthorized, onBindingRequired },
    );
    await expect(api.request("GET", "/api/conversations")).rejects.toMatchObject({ status: 403 });
    expect(onBindingRequired).toHaveBeenCalledTimes(1);
    expect(onUnauthorized).not.toHaveBeenCalled();
  });

  it("registers with email, code, nickname as snake_case keys", async () => {
    const user = { id: "12345678", name: "dan", created_at: "t", access_token: "new" };
    const { api, mock } = make({ "POST /api/users": () => json(user) });
    await api.register({ username: "dan", password: "password1", email: "dan@example.com", emailCode: "123456", nickname: "Dan", inviteCode: "inv" });
    expect(JSON.parse(mock.calls[0].body as string)).toEqual({
      username: "dan", password: "password1", email: "dan@example.com", email_code: "123456", nickname: "Dan", invite_code: "inv",
    });
    expect(mock.calls[0].headers.has("Authorization")).toBe(false);
  });
});
