import { describe, expect, it } from "vitest";
import { ApiClient } from "~/api/client";
import { createFetchMock, json } from "~/test/fetch-mock";
import { addCatalogItem, fetchCatalogPoster, listCatalog } from "./catalog-api";

const CARD = {
  id: "c1", title: "T", level: "B1", tags: ["news"], license_note: null, duration_ms: 1, seg_count: 2, has_poster: true,
  published_at: "2026-10-14T00:00:00Z", added_item_id: null,
};

function setup() {
  const mock = createFetchMock({
    "GET /api/library/catalog": () => json({ items: [CARD] }),
    "POST /api/library/catalog/c%2F1/add": () => json({ item: { id: "i1", source: "catalog" }, created: false }),
    "GET /api/library/catalog/c1/poster": () => new Response(new Uint8Array([1]), { headers: { "Content-Type": "image/jpeg" } }),
  });
  return { mock, api: new ApiClient({ getToken: () => "t", fetchImpl: mock.fetch }) };
}

describe("catalog api", () => {
  it("lists built-in items (camelCase)", async () => {
    const { api } = setup();
    const items = await listCatalog(api);
    expect(items[0].addedItemId).toBeNull();
    expect(items[0].licenseNote).toBeNull();
    expect(items[0].segCount).toBe(2);
  });

  it("adds an item (the id only in the URL, escaped) and unwraps {item, created}", async () => {
    const { api, mock } = setup();
    const out = await addCatalogItem(api, "c/1");
    expect(mock.calls[0].method).toBe("POST");
    expect(out).toEqual({ item: { id: "i1", source: "catalog" }, created: false });
  });

  it("fetches the poster as a blob", async () => {
    const { api, mock } = setup();
    const blob = await fetchCatalogPoster(api, "c1");
    expect(blob).toBeInstanceOf(Blob);
    expect(mock.calls[0].headers.get("Authorization")).toBe("Bearer t");
  });
});
