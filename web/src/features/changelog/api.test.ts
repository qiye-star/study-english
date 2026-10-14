import { describe, expect, it } from "vitest";
import { ApiClient } from "~/api/client";
import { createFetchMock, json } from "~/test/fetch-mock";
import { fetchChangelog, parseChangelogPage, postSeen } from "./api";

const wire = {
  entries: [{
    id: 3, entry_date: "2026-10-14", version: "v1.12", title_zh: "标题", title_en: "", published_at: "2026-10-14T00:00:00+00:00", is_new: true,
    items: [{ tag: "new", zh: "一", en: "one" }, { tag: "weird", zh: "二", en: "" }],
  }],
  next: "2026-10-14.3", unread: 2, latest_id: 3,
};
const client = (routes: Parameters<typeof createFetchMock>[0]) => {
  const mock = createFetchMock(routes);
  return { mock, api: new ApiClient({ getToken: () => "t", fetchImpl: mock.fetch }) };
};

describe("changelog api", () => {
  it("fetches a page with the cursor and limit in the query and parses the camelCased wire shape", async () => {
    const { mock, api } = client({ "GET /api/changelog": () => json(wire) });
    const page = await fetchChangelog(api, { cursor: "2026-10-15.9", limit: 5 });
    expect(mock.calls[0].url.search).toBe("?cursor=2026-10-15.9&limit=5");
    expect(page).toEqual({
      entries: [{
        id: 3, entryDate: "2026-10-14", version: "v1.12", titleZh: "标题", titleEn: "", publishedAt: "2026-10-14T00:00:00+00:00", isNew: true,
        items: [{ tag: "new", zh: "一", en: "one" }, { tag: "other", zh: "二", en: "" }], // an unknown tag shows as "other"
      }],
      next: "2026-10-14.3", unread: 2, latestId: 3,
    });
  });

  it("sends no query when none is given", async () => {
    const { mock, api } = client({ "GET /api/changelog": () => json({ entries: [], next: null, unread: 0, latest_id: null }) });
    expect(await fetchChangelog(api)).toEqual({ entries: [], next: null, unread: 0, latestId: null });
    expect(mock.calls[0].url.search).toBe("");
  });

  it("posts upto_id and parses the answer", async () => {
    const { mock, api } = client({ "POST /api/changelog/seen": () => json({ unread: 0, last_seen_id: 3 }) });
    expect(await postSeen(api, 3)).toEqual({ unread: 0, lastSeenId: 3 });
    expect(JSON.parse(String(mock.calls[0].body))).toEqual({ upto_id: 3 });
  });

  it("survives a malformed page: bad entries are dropped, numbers default", () => {
    expect(parseChangelogPage(null)).toEqual({ entries: [], next: null, unread: 0, latestId: null });
    const page = parseChangelogPage({
      entries: [null, { id: "x" }, { id: 1, entryDate: "2026-10-01", items: [] }, { id: 2, entryDate: "2026-10-02", items: [{ tag: "fix", zh: "", en: "" }, { tag: "fix", zh: "修", en: "" }] }],
      next: "", unread: -4, latestId: "9",
    });
    expect(page.entries.map((e) => e.id)).toEqual([2]);
    expect(page.entries[0].items).toEqual([{ tag: "fix", zh: "修", en: "" }]);
    expect(page.entries[0]).toMatchObject({ titleZh: "", titleEn: "", version: null, publishedAt: "", isNew: false });
    expect(page).toMatchObject({ next: null, unread: 0, latestId: null });
  });
});
