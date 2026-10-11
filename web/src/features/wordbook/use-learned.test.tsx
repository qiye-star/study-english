import { renderHook, waitFor, act } from "@testing-library/react";
import type { ReactNode } from "react";
import { describe, expect, it } from "vitest";
import { ApiClient } from "~/api/client";
import { createFetchMock, json } from "~/test/fetch-mock";
import { TestProviders } from "~/test/render";
import { LEARNED_ITEMS, LEARNED_SUMMARY } from "./learned-test-fixtures";
import { useLearnedList, useLearnedSummary } from "./use-learned";

const wrapper = (mock: ReturnType<typeof createFetchMock>) => ({ children }: { children: ReactNode }) => (
  <TestProviders api={new ApiClient({ getToken: () => "t", fetchImpl: mock.fetch })}>{children}</TestProviders>
);
const bodies = (mock: ReturnType<typeof createFetchMock>) =>
  mock.calls.filter((c) => c.url.pathname.endsWith("/learned/query")).map((c) => JSON.parse(String(c.body)) as Record<string, unknown>);

describe("useLearnedSummary", () => {
  it("loads the summary and stays idle when disabled", async () => {
    const mock = createFetchMock({ "GET /api/wordbook/learned/summary": () => json(LEARNED_SUMMARY) });
    const { result } = renderHook(() => useLearnedSummary(true), { wrapper: wrapper(mock) });
    await waitFor(() => expect(result.current.summary?.total).toBe(6));
    const off = createFetchMock({});
    renderHook(() => useLearnedSummary(false), { wrapper: wrapper(off) });
    expect(off.calls).toHaveLength(0);
  });
});

describe("useLearnedList", () => {
  it("loads the first page, then appends the next one with the cursor", async () => {
    const pages = [{ items: LEARNED_ITEMS.slice(0, 2), next_cursor: "c1" }, { items: LEARNED_ITEMS.slice(2), next_cursor: null }];
    const mock = createFetchMock({ "POST /api/wordbook/learned/query": () => json(pages.shift()) });
    const { result } = renderHook(() => useLearnedList({}), { wrapper: wrapper(mock) });
    await waitFor(() => expect(result.current.status).toBe("idle"));
    expect(result.current.items).toHaveLength(2);
    expect(result.current.hasMore).toBe(true);
    await act(async () => { await result.current.loadMore(); });
    expect(result.current.items.map((i) => i.key)).toEqual(["accept", "carry", "talk"]);
    expect(result.current.hasMore).toBe(false);
    expect(bodies(mock)[1].cursor).toBe("c1");
  });

  it("starts over when the query changes and ignores the stale response", async () => {
    let release: (() => void) | undefined;
    const mock = createFetchMock({
      "POST /api/wordbook/learned/query": async (call) => {
        const body = JSON.parse(String(call.body)) as { q?: string };
        if (!body.q) await new Promise<void>((resolve) => { release = resolve; });
        return json({ items: body.q ? [LEARNED_ITEMS[0]] : LEARNED_ITEMS, next_cursor: null });
      },
    });
    const { result, rerender } = renderHook(({ q }: { q?: string }) => useLearnedList(q ? { q } : {}), {
      wrapper: wrapper(mock), initialProps: {} as { q?: string },
    });
    rerender({ q: "ac" });
    await waitFor(() => expect(result.current.status).toBe("idle"));
    release?.();
    await new Promise((r) => setTimeout(r, 20));
    expect(result.current.items.map((i) => i.key)).toEqual(["accept"]);
  });
});
