import { describe, expect, it, vi } from "vitest";
import { ApiError, createClient } from "./client";

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

function setup(response: Response | (() => Promise<Response>), token: string | null = "tok") {
  const fetchImpl = vi.fn(typeof response === "function" ? response : async () => response);
  const onUnauthorized = vi.fn();
  const request = createClient({ getToken: () => token, onUnauthorized, fetchImpl: fetchImpl as unknown as typeof fetch });
  return { fetchImpl, onUnauthorized, request };
}

describe("api client", () => {
  it("sends the bearer token and builds the query string, dropping empty values", async () => {
    const { fetchImpl, request } = setup(json({ ok: true }));
    await expect(request("/api/admin/users", { query: { q: "", page: 2, per_page: 20, source: undefined } })).resolves.toEqual({ ok: true });
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("/api/admin/users?page=2&per_page=20");
    expect((init.headers as Record<string, string>).Authorization).toBe("Bearer tok");
  });

  it("does not send auth for the login call and does not treat its 401 as an expired session", async () => {
    const { fetchImpl, onUnauthorized, request } = setup(json({ error: "账号或密码错误" }, 401));
    await expect(request("/api/admin/login", { json: { username: "a", password: "b" }, auth: false })).rejects.toMatchObject({
      status: 401,
      message: "账号或密码错误",
    });
    const [, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect((init.headers as Record<string, string>).Authorization).toBeUndefined();
    expect(init.method).toBe("POST");
    expect(init.body).toBe(JSON.stringify({ username: "a", password: "b" }));
    expect(onUnauthorized).not.toHaveBeenCalled();
  });

  it("calls onUnauthorized on a 401 for authenticated requests", async () => {
    const { onUnauthorized, request } = setup(json({ error: "expired" }, 401));
    await expect(request("/api/admin/overview")).rejects.toBeInstanceOf(ApiError);
    expect(onUnauthorized).toHaveBeenCalledTimes(1);
  });

  it("extracts the error message from the JSON body, with a fallback for other bodies", async () => {
    const a = setup(json({ error: "用户不存在" }, 404));
    await expect(a.request("/x")).rejects.toMatchObject({ status: 404, message: "用户不存在" });
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

  it("returns a blob when asked", async () => {
    const { request } = setup(new Response(new Uint8Array([82, 73, 70, 70]), { headers: { "Content-Type": "audio/wav" } }));
    const blob = await request<Blob>("/audio", { as: "blob" });
    expect(blob.size).toBe(4);
  });
});
