import "fake-indexeddb/auto";
import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import { ApiClient } from "~/api/client";
import { resetKvCacheForTests } from "~/lib/kv-cache";
import { createFetchMock, json } from "~/test/fetch-mock";
import { useMessageTranslations } from "./use-message-translations";

const reply = (content: string) => json({ choices: [{ message: { content } }] });

describe("useMessageTranslations", () => {
  beforeEach(() => { indexedDB.deleteDatabase("enjoy-web"); resetKvCacheForTests(); });

  it("translates on demand, toggles without refetching and reuses the cache after remount", async () => {
    const mock = createFetchMock({ "POST /api/ai/chat/completions": () => reply("你好") });
    const api = new ApiClient({ getToken: () => "t", fetchImpl: mock.fetch });
    const first = renderHook(() => useMessageTranslations(api, "zh-CN"));
    act(() => first.result.current.toggle("m1", "**Hello**"));
    await waitFor(() => expect(first.result.current.states.m1).toEqual({ status: "done", text: "你好" }));
    const body = JSON.parse(mock.calls[0].body as string);
    expect(body.messages.at(-1).content).toContain("Hello");
    expect(body.messages.at(-1).content).not.toContain("**");
    act(() => first.result.current.toggle("m1", "**Hello**"));
    expect(first.result.current.open.m1).toBe(false);
    act(() => first.result.current.toggle("m1", "**Hello**"));
    expect(first.result.current.open.m1).toBe(true);
    expect(mock.calls).toHaveLength(1);
    first.unmount();
    const second = renderHook(() => useMessageTranslations(api, "zh-CN"));
    act(() => second.result.current.show("m9", "**Hello**"));
    await waitFor(() => expect(second.result.current.states.m9).toEqual({ status: "done", text: "你好" }));
    expect(mock.calls).toHaveLength(1);
  });

  it("reports errors and retries", async () => {
    let fail = true;
    const mock = createFetchMock({ "POST /api/ai/chat/completions": () => (fail ? json({ error: "Upstream unavailable" }, 502) : reply("好")) });
    const { result } = renderHook(() => useMessageTranslations(new ApiClient({ getToken: () => "t", fetchImpl: mock.fetch }), "zh-CN"));
    act(() => result.current.show("m1", "Fine"));
    await waitFor(() => expect(result.current.states.m1).toEqual({ status: "error", error: "The AI service is unavailable. Please try again." }));
    fail = false;
    act(() => result.current.retry("m1", "Fine"));
    await waitFor(() => expect(result.current.states.m1).toEqual({ status: "done", text: "好" }));
  });

  it("ignores a late answer after unmount and after reset", async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const mock = createFetchMock({ "POST /api/ai/chat/completions": async () => { await gate; return reply("迟到"); } });
    const { result, unmount } = renderHook(() => useMessageTranslations(new ApiClient({ getToken: () => "t", fetchImpl: mock.fetch }), "zh-CN"));
    act(() => result.current.show("m1", "Late"));
    act(() => result.current.reset());
    expect(result.current.states).toEqual({});
    unmount();
    await act(async () => { release(); await gate; });
    expect(result.current.states).toEqual({});
  });
});
