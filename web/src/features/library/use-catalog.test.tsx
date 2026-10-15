import { act, renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { describe, expect, it } from "vitest";
import { ApiClient, ApiError } from "~/api/client";
import { translateServerError } from "~/api/error-messages";
import i18n from "~/i18n";
import { createFetchMock, json, type Handler } from "~/test/fetch-mock";
import { TestProviders } from "~/test/render";
import { markItemGone, resetGoneItems } from "./gone-items";
import { LIBRARY_SERVER_ERRORS } from "./library-api";
import "./locales";
import { itemRaw } from "./test-fixtures";
import { setUiLanguage } from "./test-i18n";
import { useCatalog } from "./use-catalog";

const card = (id: string, over: Record<string, unknown> = {}): Record<string, unknown> => ({
  id, title: `T ${id}`, level: "B1", tags: [], license_note: null, duration_ms: 1000, seg_count: 2, has_poster: false,
  published_at: "2026-10-14T00:00:00Z", added_item_id: null, ...over,
});

function setup(addHandler: Handler = () => json({ item: itemRaw({ id: "i9", source: "catalog" }), created: true })) {
  const mock = createFetchMock({
    "GET /api/library/catalog": () => json({ items: [card("c1"), card("c2")] }),
    "POST /api/library/catalog/c1/add": addHandler,
  });
  const api = new ApiClient({ getToken: () => "t", fetchImpl: mock.fetch });
  const wrapper = ({ children }: { children: ReactNode }) => <TestProviders api={api}>{children}</TestProviders>;
  return { mock, ...renderHook(() => useCatalog(true), { wrapper }) };
}

describe("useCatalog", () => {
  it("loads the list once", async () => {
    const { result, mock } = setup();
    await waitFor(() => expect(result.current.items).toHaveLength(2));
    expect(result.current.loading).toBe(false);
    expect(mock.calls.filter((c) => c.method === "GET")).toHaveLength(1);
  });

  it("add marks the card as added without reloading", async () => {
    const { result, mock } = setup();
    await waitFor(() => expect(result.current.items).toHaveLength(2));
    await act(async () => { await result.current.add("c1"); });
    expect(result.current.items[0].addedItemId).toBe("i9");
    expect(result.current.items[1].addedItemId).toBeNull();
    expect(result.current.adding.size).toBe(0);
    expect(mock.calls.filter((c) => c.method === "GET")).toHaveLength(1);
  });

  it("a double tap sends one request and shares the promise", async () => {
    let release: () => void = () => {};
    const gate = new Promise<void>((r) => { release = r; });
    const { result, mock } = setup(async () => {
      await gate;
      return json({ item: itemRaw({ id: "i9" }), created: true });
    });
    await waitFor(() => expect(result.current.items).toHaveLength(2));
    let a!: Promise<unknown>;
    let b!: Promise<unknown>;
    act(() => { a = result.current.add("c1"); b = result.current.add("c1"); });
    expect(a).toBe(b);
    expect(result.current.adding.has("c1")).toBe(true);
    await act(async () => { release(); await a; });
    expect(mock.calls.filter((c) => c.method === "POST")).toHaveLength(1);
  });

  it("404 removes the card at once and rethrows an error that maps to the not-found text", async () => {
    await setUiLanguage("zh-CN");
    const { result } = setup(() => json({ error: "Built-in item not found" }, 404));
    await waitFor(() => expect(result.current.items).toHaveLength(2));
    let caught: unknown;
    await act(async () => { await result.current.add("c1").catch((e: unknown) => { caught = e; }); });
    expect(caught).toBeInstanceOf(ApiError);
    expect(result.current.items.map((c) => c.id)).toEqual(["c2"]);
    expect(translateServerError(i18n.t.bind(i18n), caught, LIBRARY_SERVER_ERRORS)).toBe("这条精选素材已下架。");
  });

  it("clears addedItemId for a copy the player reported gone, and reloads quietly on foreground", async () => {
    resetGoneItems();
    let added: string | null = "i9";
    const mock = createFetchMock({ "GET /api/library/catalog": () => json({ items: [card("c1", { added_item_id: added })] }) });
    const api = new ApiClient({ getToken: () => "t", fetchImpl: mock.fetch });
    const wrapper = ({ children }: { children: ReactNode }) => <TestProviders api={api}>{children}</TestProviders>;
    const { result } = renderHook(() => useCatalog(true), { wrapper });
    await waitFor(() => expect(result.current.items[0]?.addedItemId).toBe("i9"));
    added = null; // copy removed on another device
    window.dispatchEvent(new Event("focus"));
    await waitFor(() => expect(result.current.items[0].addedItemId).toBeNull());
    expect(result.current.loading).toBe(false);
    added = "i9";
    markItemGone("i9"); // server list still stale, but the player already saw 404
    result.current.reload();
    await waitFor(() => expect(mock.calls.length).toBeGreaterThanOrEqual(3));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.items[0].addedItemId).toBeNull();
    resetGoneItems();
  });

  it("other failures keep the card", async () => {
    const { result } = setup(() => json({ error: "boom" }, 500));
    await waitFor(() => expect(result.current.items).toHaveLength(2));
    await act(async () => { await result.current.add("c1").catch(() => {}); });
    expect(result.current.items).toHaveLength(2);
    expect(result.current.adding.size).toBe(0);
  });
});
function setupAdded(del: Handler, add: Handler = () => json({ item: itemRaw({ id: "i2", source: "catalog" }), created: true })) {
  const mock = createFetchMock({
    "GET /api/library/catalog": () => json({ items: [card("c1", { added_item_id: "i1" }), card("c2")] }),
    "DELETE /api/library/items/i1": del,
    "POST /api/library/catalog/c1/add": add,
  });
  const api = new ApiClient({ getToken: () => "t", fetchImpl: mock.fetch });
  const wrapper = ({ children }: { children: ReactNode }) => <TestProviders api={api}>{children}</TestProviders>;
  return { mock, ...renderHook(() => useCatalog(true), { wrapper }) };
}
const deletes = (mock: { calls: { method: string }[] }) => mock.calls.filter((c) => c.method === "DELETE").length;

describe("useCatalog.remove (cancel an add)", () => {
  it("deletes the copy and puts the card back to not added, without reloading the list", async () => {
    const { result, mock } = setupAdded(() => json({ deleted: true }));
    await waitFor(() => expect(result.current.items).toHaveLength(2));
    await act(async () => { await result.current.remove("c1", "i1"); });
    expect(result.current.items[0].addedItemId).toBeNull();
    expect(result.current.removing.size).toBe(0);
    expect(deletes(mock)).toBe(1);
    expect(mock.calls.filter((c) => c.method === "GET")).toHaveLength(1);
  });

  it("a double tap sends one DELETE and shares the promise", async () => {
    let release: () => void = () => {};
    const gate = new Promise<void>((r) => { release = r; });
    const { result, mock } = setupAdded(async () => { await gate; return json({ deleted: true }); });
    await waitFor(() => expect(result.current.items).toHaveLength(2));
    let a!: Promise<unknown>;
    let b!: Promise<unknown>;
    act(() => { a = result.current.remove("c1", "i1"); b = result.current.remove("c1", "i1"); });
    expect(a).toBe(b);
    expect(result.current.removing.has("c1")).toBe(true);
    await act(async () => { release(); await a; });
    expect(deletes(mock)).toBe(1);
  });

  it("404 Not Found means it is already gone: treated as success", async () => {
    const { result } = setupAdded(() => json({ error: "Not Found" }, 404));
    await waitFor(() => expect(result.current.items).toHaveLength(2));
    await act(async () => { await result.current.remove("c1", "i1"); });
    expect(result.current.items[0].addedItemId).toBeNull();
  });

  it("other 404s (library switched off) and 500s rethrow and keep the card added", async () => {
    for (const reply of [() => json({ error: "Library is disabled" }, 404), () => json({ error: "boom" }, 500)]) {
      const { result, unmount } = setupAdded(reply);
      await waitFor(() => expect(result.current.items).toHaveLength(2));
      let caught: unknown;
      await act(async () => { await result.current.remove("c1", "i1").catch((e: unknown) => { caught = e; }); });
      expect(caught).toBeInstanceOf(ApiError);
      expect(result.current.items[0].addedItemId).toBe("i1");
      expect(result.current.removing.size).toBe(0);
      unmount();
    }
  });

  it("add → cancel → add again makes a fresh copy", async () => {
    const { result, mock } = setupAdded(() => json({ deleted: true }));
    await waitFor(() => expect(result.current.items).toHaveLength(2));
    await act(async () => { await result.current.remove("c1", "i1"); });
    await act(async () => { await result.current.add("c1"); });
    expect(result.current.items[0].addedItemId).toBe("i2");
    expect(mock.calls.filter((c) => c.method === "POST")).toHaveLength(1);
    expect(deletes(mock)).toBe(1);
  });
});
