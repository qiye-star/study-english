import "fake-indexeddb/auto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ApiClient } from "~/api/client";
import { kvGet, resetKvCacheForTests } from "~/lib/kv-cache";
import { createFetchMock, json } from "~/test/fetch-mock";
import { HINTS_SYSTEM_PROMPT, buildHintsRequest, cachedHints, clearHintsMemory, hintsCacheKey, parseHints, type HintsInput } from "./hints";

const REPLIES = { replies: [{ text: "I'd like a latte.", zh: "我想要一杯拿铁。" }, { text: "What do you recommend?", zh: "你推荐什么?" }, { text: "Just water, thanks.", zh: "白水就好,谢谢。" }] };
const completion = (content: unknown) => json({ choices: [{ message: { content: typeof content === "string" ? content : JSON.stringify(content) } }] });
const INPUT: HintsInput = {
  conversationId: "c1", anchor: { id: "m2", key: "m2" }, level: "auto", scenarioId: "cafe",
  messages: [{ role: "assistant", content: "Welcome! What can I get you?" }],
};
function deleteDb(): Promise<void> {
  return new Promise((resolve) => {
    const req = indexedDB.deleteDatabase("enjoy-web");
    req.onsuccess = req.onerror = req.onblocked = () => resolve();
  });
}

describe("hints", () => {
  beforeEach(async () => {
    resetKvCacheForTests();
    await deleteDb();
    clearHintsMemory();
  });

  it("builds a fixed prompt with the last 6 messages, clipped, as data", () => {
    const messages = Array.from({ length: 8 }, (_, i) => ({ role: (i % 2 ? "user" : "assistant") as "user" | "assistant", content: `m${i} ${"x".repeat(500)}` }));
    const [system, user] = buildHintsRequest({ level: "B1", scenarioId: null, messages });
    expect(system).toEqual({ role: "system", content: `${HINTS_SYSTEM_PROMPT}\n\nThe learner is at CEFR B1 level: write the three replies at that level.` });
    const data = JSON.parse(user.content);
    expect(data.scenario).toBeNull();
    expect(data.conversation).toHaveLength(6);
    expect(data.conversation[0]).toEqual({ speaker: "partner", text: `m2 ${"x".repeat(397)}` });
    expect(data.conversation[1].speaker).toBe("learner");
    expect(buildHintsRequest({ level: "auto", scenarioId: "cafe", messages: [] })[0].content).toBe(HINTS_SYSTEM_PROMPT);
  });

  it("parses exactly three replies strictly", () => {
    expect(parseHints(JSON.stringify(REPLIES))).toEqual(REPLIES.replies);
    expect(parseHints("```json\n" + JSON.stringify(REPLIES) + "\n```")).toHaveLength(3);
    expect(parseHints(JSON.stringify({ replies: [{ text: "  Two   spaces ", zh: " 两个 " }, ...REPLIES.replies.slice(1)] }))[0]).toEqual({ text: "Two spaces", zh: "两个" });
    const bad = [
      "nope", JSON.stringify(REPLIES.replies), JSON.stringify({ replies: REPLIES.replies.slice(0, 2) }),
      JSON.stringify({ replies: [...REPLIES.replies, REPLIES.replies[0]] }),
      JSON.stringify({ replies: [{ text: "", zh: "x" }, ...REPLIES.replies.slice(1)] }),
      JSON.stringify({ replies: [{ text: "ok", zh: "" }, ...REPLIES.replies.slice(1)] }),
      JSON.stringify({ replies: [{ text: 5, zh: "x" }, ...REPLIES.replies.slice(1)] }),
      JSON.stringify({ replies: [{ text: "a".repeat(301), zh: "x" }, ...REPLIES.replies.slice(1)] }),
      JSON.stringify({ replies: [null, ...REPLIES.replies.slice(1)] }),
    ];
    for (const raw of bad) expect(() => parseHints(raw)).toThrow("Invalid hints response");
  });

  it("calls the AI once per anchor + level (JSON mode), then serves the IndexedDB cache", async () => {
    const mock = createFetchMock({ "POST /api/ai/chat/completions": () => completion(REPLIES) });
    const api = new ApiClient({ getToken: () => "t", fetchImpl: mock.fetch });
    expect(await cachedHints(api, INPUT)).toEqual(REPLIES.replies);
    const body = JSON.parse(mock.calls[0].body as string);
    expect(body).toMatchObject({ stream: false, temperature: 0.7, response_format: { type: "json_object" } });
    expect(body.model).toBeUndefined();
    expect(await cachedHints(api, INPUT)).toEqual(REPLIES.replies);
    expect(mock.calls).toHaveLength(1);
    expect(await kvGet(hintsCacheKey("c1", "m2", "auto"))).toEqual(REPLIES.replies);
    await cachedHints(api, { ...INPUT, level: "B1" });
    expect(mock.calls).toHaveLength(2);
  });

  it("keeps hints for a reply without a server id in memory only", async () => {
    const mock = createFetchMock({ "POST /api/ai/chat/completions": () => completion(REPLIES) });
    const api = new ApiClient({ getToken: () => "t", fetchImpl: mock.fetch });
    const unsaved = { ...INPUT, anchor: { key: "a-7" } };
    await cachedHints(api, unsaved);
    await cachedHints(api, unsaved);
    expect(mock.calls).toHaveLength(1);
    expect(await kvGet(hintsCacheKey("c1", "local:a-7", "auto"))).toBeUndefined();
    clearHintsMemory();
    await cachedHints(api, unsaved);
    expect(mock.calls).toHaveLength(2);
  });

  it("does not cache failures and shares concurrent requests", async () => {
    let bad = true;
    const mock = createFetchMock({ "POST /api/ai/chat/completions": () => completion(bad ? { replies: [] } : REPLIES) });
    const api = new ApiClient({ getToken: () => "t", fetchImpl: mock.fetch });
    await expect(cachedHints(api, INPUT)).rejects.toThrow("Invalid hints response");
    bad = false;
    const [a, b] = await Promise.all([cachedHints(api, INPUT), cachedHints(api, INPUT)]);
    expect(a).toEqual(b);
    expect(mock.calls).toHaveLength(2);
  });
  it("aborts the request when its only caller stops waiting, and asks again next time", async () => {
    let seen: AbortSignal | undefined;
    let calls = 0;
    const mock = createFetchMock({
      "POST /api/ai/chat/completions": (call) => {
        calls += 1;
        if (calls > 1) return completion(REPLIES);
        seen = call.signal!;
        return new Promise<Response>((_, reject) => call.signal!.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError"))));
      },
    });
    const api = new ApiClient({ getToken: () => "t", fetchImpl: mock.fetch });
    const controller = new AbortController();
    const first = cachedHints(api, INPUT, controller.signal);
    await vi.waitFor(() => expect(seen).toBeDefined());
    controller.abort();
    await expect(first).rejects.toMatchObject({ name: "AbortError" });
    expect(seen!.aborted).toBe(true);
    expect(await cachedHints(api, INPUT, new AbortController().signal)).toHaveLength(3);
    expect(calls).toBe(2);
  });
});
