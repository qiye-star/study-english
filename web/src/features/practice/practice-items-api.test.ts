import { describe, expect, it } from "vitest";
import { ApiClient } from "~/api/client";
import { createFetchMock, json } from "~/test/fetch-mock";
import { addPracticeItem, deletePracticeItem, listPracticeItems } from "./practice-items-api";
import { practiceReference } from "./save-practice-item";

const ITEM = { id: "p1", text: "Hello there.", source: "chat", created_at: "2026-10-05T00:00:00+00:00" };

describe("practice items api", () => {
  it("lists, adds and deletes", async () => {
    const mock = createFetchMock({
      "GET /api/practice-items": () => json({ practice_items: [ITEM], page: 1, next: null }),
      "POST /api/practice-items": () => json(ITEM),
      "DELETE /api/practice-items/p1": () => json({ id: "p1" }),
    });
    const api = new ApiClient({ getToken: () => "t", fetchImpl: mock.fetch });
    const page = await listPracticeItems(api);
    expect(page.practiceItems).toEqual([{ id: "p1", text: "Hello there.", source: "chat", createdAt: "2026-10-05T00:00:00+00:00" }]);
    expect(mock.calls[0].url.search).toBe("?page=1&per_page=50");
    await addPracticeItem(api, { text: "x".repeat(2100), source: "lookup" });
    expect(JSON.parse(mock.calls[1].body as string)).toEqual({ text: "x".repeat(2000), source: "lookup" });
    expect(await deletePracticeItem(api, "p1")).toEqual({ id: "p1" });
  });

  it("builds a practice reference", () => {
    expect(practiceReference("  Hello \n  there ")).toBe("Hello there");
    expect(practiceReference("a".repeat(2500))).toHaveLength(2000);
  });
});
