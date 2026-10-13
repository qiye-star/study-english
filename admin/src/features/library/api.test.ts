import { afterEach, describe, expect, it, vi } from "vitest";
import {
  camel,
  cancelLibraryItem,
  deleteLibraryItem,
  deletePhrase,
  fetchLibraryItems,
  fetchLibraryOverview,
  fetchUserLibrary,
  purgeFailedItems,
} from "./api";

const ID = "3f2a9c1e-0000-4000-8000-000000000001";

function stub(body: unknown) {
  const calls: { url: string; init: RequestInit }[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init: RequestInit) => {
      calls.push({ url, init });
      return new Response(JSON.stringify(body), { status: 200, headers: { "Content-Type": "application/json" } });
    }),
  );
  return calls;
}

afterEach(() => vi.unstubAllGlobals());

describe("library admin api", () => {
  it("camelCases keys but keeps status names", () => {
    expect(camel({ by_status: { failed: 1 }, asr: { today_minutes: 2 }, purge_confirm: "PURGE 1 ITEMS" })).toEqual({
      byStatus: { failed: 1 },
      asr: { todayMinutes: 2 },
      purgeConfirm: "PURGE 1 ITEMS",
    });
  });

  it("reads the overview", async () => {
    stub({
      enabled: true,
      by_status: { failed: 2 },
      purge_confirm: "PURGE 2 ITEMS",
      tools: { ffmpeg: "7.1", ytdlp: null },
      ai: { enabled: true, available: true, today_translated: 120, today_analysed: 4, global_daily: 5000,
        translate_daily_per_user: 500, analysis_daily_per_user: 30 },
    });
    const o = await fetchLibraryOverview();
    expect(o.ai).toEqual({ enabled: true, available: true, todayTranslated: 120, todayAnalysed: 4, globalDaily: 5000,
      translateDailyPerUser: 500, analysisDailyPerUser: 30 });
    expect(o.byStatus.failed).toBe(2);
    expect(o.purgeConfirm).toBe("PURGE 2 ITEMS");
    expect(o.tools).toEqual({ ffmpeg: "7.1", ytdlp: null });
  });

  it("sends filters as query parameters and leaves out 'all'", async () => {
    const calls = stub({ items: [], page: 1, next: null, total: 0 });
    await fetchLibraryItems({ status: "failed", kind: "all", userId: "10000101" }, 2);
    expect(calls[0].url).toBe("/api/admin/library/items?status=failed&user_id=10000101&page=2");
    await fetchLibraryItems({ status: "all", kind: "video", userId: null });
    expect(calls[1].url).toBe("/api/admin/library/items?kind=video&page=1");
  });

  it("builds the delete phrase from the first 8 characters of the id", () => {
    expect(deletePhrase(ID)).toBe("DELETE 3f2a9c1e");
  });

  it("posts delete, cancel and purge with reason and phrase", async () => {
    const calls = stub({ ok: true });
    await deleteLibraryItem(ID, "清理旧素材", "DELETE 3f2a9c1e");
    await cancelLibraryItem(ID, "卡住了");
    await purgeFailedItems("每周清理", "PURGE 2 ITEMS");
    expect(calls.map((c) => [c.url, c.init.method])).toEqual([
      [`/api/admin/library/items/${ID}/delete`, "POST"],
      [`/api/admin/library/items/${ID}/cancel`, "POST"],
      ["/api/admin/library/purge-failed", "POST"],
    ]);
    expect(JSON.parse(String(calls[0].init.body))).toEqual({ reason: "清理旧素材", confirm: "DELETE 3f2a9c1e" });
    expect(JSON.parse(String(calls[1].init.body))).toEqual({ reason: "卡住了" });
    expect(JSON.parse(String(calls[2].init.body))).toEqual({ reason: "每周清理", confirm: "PURGE 2 ITEMS" });
  });

  it("reads one user's usage", async () => {
    const calls = stub({ user_id: 10000101, enabled: true, items: 2, bytes: 10, quota_mb: 2000, max_items: 100, by_status: {} });
    const u = await fetchUserLibrary("10000101");
    expect(calls[0].url).toBe("/api/admin/library/users/10000101");
    expect([u.items, u.quotaMb, u.maxItems]).toEqual([2, 2000, 100]);
  });
});
