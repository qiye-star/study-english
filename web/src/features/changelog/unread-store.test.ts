import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ApiClient } from "~/api/client";
import { createFetchMock, json } from "~/test/fetch-mock";
import { markSeen, refreshUnread, resetUnreadForTests, unreadSnapshot } from "./unread-store";

const page = (unread: number, latest: number | null) => json({ entries: [], next: null, unread, latest_id: latest });
function client(routes: Parameters<typeof createFetchMock>[0]) {
  const mock = createFetchMock(routes);
  return { mock, api: new ApiClient({ getToken: () => "t", fetchImpl: mock.fetch }) };
}
beforeEach(() => resetUnreadForTests());
afterEach(() => vi.restoreAllMocks());

describe("changelog unread store (R-14)", () => {
  it("loads unread and latest id with limit=1 and does not ask again within a minute", async () => {
    const { mock, api } = client({ "GET /api/changelog": () => page(2, 7) });
    expect(unreadSnapshot(api, "u1")).toEqual({ status: "idle", unread: 0, latestId: null });
    await refreshUnread(api, "u1");
    expect(unreadSnapshot(api, "u1")).toEqual({ status: "ready", unread: 2, latestId: 7 });
    expect(mock.calls[0].url.search).toBe("?limit=1");
    await refreshUnread(api, "u1");
    expect(mock.calls).toHaveLength(1);
    await refreshUnread(api, "u1", true);
    expect(mock.calls).toHaveLength(2);
    vi.spyOn(Date, "now").mockReturnValue(Date.now() + 61_000);
    await refreshUnread(api, "u1");
    expect(mock.calls).toHaveLength(3);
  });

  it("shares one in-flight request", async () => {
    const { mock, api } = client({ "GET /api/changelog": () => page(1, 1) });
    await Promise.all([refreshUnread(api, "u1"), refreshUnread(api, "u1")]);
    expect(mock.calls).toHaveLength(1);
  });

  it("goes to the error state quietly when the request fails", async () => {
    const { api } = client({ "GET /api/changelog": () => json({ error: "boom" }, 500) });
    await refreshUnread(api, "u1");
    expect(unreadSnapshot(api, "u1")).toEqual({ status: "error", unread: 0, latestId: null });
  });

  it("never shows one user's state to another user or another client", async () => {
    const { mock, api } = client({ "GET /api/changelog": () => page(3, 9) });
    await refreshUnread(api, "u1");
    expect(unreadSnapshot(api, "u2")).toEqual({ status: "idle", unread: 0, latestId: null });
    expect(unreadSnapshot(client({}).api, "u1").status).toBe("idle");
    await refreshUnread(api, "u2");
    expect(mock.calls).toHaveLength(2);
    expect(unreadSnapshot(api, "u1").status).toBe("idle"); // u1's state was replaced, not leaked
  });

  it("markSeen reports upto_id, updates the count and ignores failures", async () => {
    const { mock, api } = client({
      "GET /api/changelog": () => page(2, 7),
      "POST /api/changelog/seen": () => json({ unread: 0, last_seen_id: 7 }),
    });
    await refreshUnread(api, "u1");
    await markSeen(api, "u1", 7);
    expect(JSON.parse(String(mock.calls[1].body))).toEqual({ upto_id: 7 });
    expect(unreadSnapshot(api, "u1")).toEqual({ status: "ready", unread: 0, latestId: 7 });
    const failing = client({ "GET /api/changelog": () => page(2, 7), "POST /api/changelog/seen": () => json({ error: "x" }, 500) });
    await refreshUnread(failing.api, "u1");
    await expect(markSeen(failing.api, "u1", 7)).resolves.toBeUndefined();
    expect(unreadSnapshot(failing.api, "u1").unread).toBe(2);
  });
});
