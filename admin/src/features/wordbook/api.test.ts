import { afterEach, describe, expect, it, vi } from "vitest";
import { camel, fetchWordbookAdmin, reloadWordbook } from "./api";

afterEach(() => vi.unstubAllGlobals());

describe("wordbook admin api", () => {
  it("camelCases nested keys, digits included", () => {
    expect(camel({ learners_7d: 1, file: { sha256_ok: true }, index: { built_ms: null } })).toEqual({
      learners7d: 1, file: { sha256Ok: true }, index: { builtMs: null },
    });
  });

  it("reads the overview and posts a reload with a reason", async () => {
    const calls: { url: string; init: RequestInit }[] = [];
    vi.stubGlobal("fetch", vi.fn(async (url: string, init: RequestInit) => {
      calls.push({ url, init });
      const body = url.endsWith("/reload") ? { ok: true }
        : { enabled: true, ai: { enabled: false, available: false, today_calls: 0, global_daily: 200, cached: 3 }, books: [] };
      return new Response(JSON.stringify(body), { status: 200, headers: { "Content-Type": "application/json" } });
    }));
    expect((await fetchWordbookAdmin()).ai).toEqual({ enabled: false, available: false, todayCalls: 0, globalDaily: 200, cached: 3 });
    await reloadWordbook("data updated");
    expect(calls[1].url).toBe("/api/admin/wordbook/reload");
    expect(calls[1].init.method).toBe("POST");
    expect(JSON.parse(String(calls[1].init.body))).toEqual({ reason: "data updated" });
  });
});
