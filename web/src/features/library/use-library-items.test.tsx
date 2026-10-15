import { act, renderHook } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ApiClient } from "~/api/client";
import { createFetchMock, json } from "~/test/fetch-mock";
import { TestProviders } from "~/test/render";
import type { LibraryItem } from "./library-api";
import { markItemGone, resetGoneItems } from "./gone-items";
import { itemRaw } from "./test-fixtures";
import { mergeFirstPage, useLibraryItems } from "./use-library-items";

const item = (id: string, status = "ready") => ({ id, status } as LibraryItem);
const tick = (ms: number) => act(async () => { await vi.advanceTimersByTimeAsync(ms); });
let visibility: DocumentVisibilityState = "visible";

beforeEach(() => {
  vi.useFakeTimers();
  visibility = "visible";
  Object.defineProperty(document, "visibilityState", { configurable: true, get: () => visibility });
});
afterEach(() => {
  vi.useRealTimers();
});

function setup(status: { value: string }) {
  const mock = createFetchMock({
    "GET /api/library/items": () => json({ items: [itemRaw({ status: status.value, progress: 40 })], next_cursor: null }),
  });
  const api = new ApiClient({ getToken: () => "t", fetchImpl: mock.fetch });
  const wrapper = ({ children }: { children: ReactNode }) => <TestProviders api={api}>{children}</TestProviders>;
  return { mock, ...renderHook(() => useLibraryItems(true), { wrapper }) };
}

describe("mergeFirstPage (R-L11)", () => {
  it("updates known items, puts new ones first and keeps later pages", () => {
    const prev = [item("b", "processing"), item("c"), item("old")];
    const fresh = [item("a", "queued"), item("b", "ready"), item("c")];
    expect(mergeFirstPage(prev, fresh).map((i) => `${i.id}:${i.status}`)).toEqual(["a:queued", "b:ready", "c:ready", "old:ready"]);
  });
});

describe("useLibraryItems polling (R-L11)", () => {
  it("polls every 3 s only while something is queued or processing", async () => {
    const status = { value: "processing" };
    const { mock, result } = setup(status);
    await tick(0);
    expect(result.current.items[0].status).toBe("processing");
    expect(mock.calls).toHaveLength(1);
    await tick(3000);
    expect(mock.calls).toHaveLength(2);
    status.value = "ready";
    await tick(3000);
    expect(mock.calls).toHaveLength(3);
    expect(result.current.items[0].status).toBe("ready");
    await tick(9000);
    expect(mock.calls).toHaveLength(3);
  });

  it("stops while the page is hidden and refreshes at once when it is visible again", async () => {
    const { mock } = setup({ value: "queued" });
    await tick(0);
    visibility = "hidden";
    document.dispatchEvent(new Event("visibilitychange"));
    await tick(9000);
    expect(mock.calls).toHaveLength(1);
    visibility = "visible";
    document.dispatchEvent(new Event("visibilitychange"));
    await tick(0);
    expect(mock.calls).toHaveLength(2);
    await tick(3000);
    expect(mock.calls).toHaveLength(3);
  });

  it("revalidates on foreground and drops items deleted elsewhere", async () => {
    let ids = ["i1", "i2"];
    const mock = createFetchMock({ "GET /api/library/items": () => json({ items: ids.map((id) => itemRaw({ id })), next_cursor: null }) });
    const api = new ApiClient({ getToken: () => "t", fetchImpl: mock.fetch });
    const wrapper = ({ children }: { children: ReactNode }) => <TestProviders api={api}>{children}</TestProviders>;
    const { result } = renderHook(() => useLibraryItems(true), { wrapper });
    await tick(0);
    expect(result.current.items.map((i) => i.id)).toEqual(["i1", "i2"]);
    ids = ["i1"];
    window.dispatchEvent(new Event("focus"));
    await tick(0);
    expect(result.current.items.map((i) => i.id)).toEqual(["i1"]);
    expect(result.current.loading).toBe(false);
    document.dispatchEvent(new Event("visibilitychange")); // focus + visibility together: one request
    await tick(0);
    expect(mock.calls).toHaveLength(2);
  });

  it("never shows an item the player reported gone", async () => {
    resetGoneItems();
    markItemGone("i1");
    const { result } = setup({ value: "ready" });
    await tick(0);
    expect(result.current.items).toEqual([]);
    resetGoneItems();
  });

  it("does not poll for items that are only uploading", async () => {
    const { mock } = setup({ value: "uploading" });
    await tick(0);
    await tick(9000);
    expect(mock.calls).toHaveLength(1);
  });

  it("replaces and removes items locally", async () => {
    const { result } = setup({ value: "ready" });
    await tick(0);
    act(() => result.current.replace({ ...result.current.items[0], status: "queued" }));
    expect(result.current.items[0].status).toBe("queued");
    act(() => result.current.replace({ ...result.current.items[0], id: "new" }));
    expect(result.current.items.map((i) => i.id)).toEqual(["new", "i1"]);
    act(() => result.current.remove("i1"));
    expect(result.current.items.map((i) => i.id)).toEqual(["new"]);
  });
});
