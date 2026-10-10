import "fake-indexeddb/auto";
import { describe, expect, it, vi } from "vitest";
import { ApiClient } from "~/api/client";
import { createFetchMock, json } from "~/test/fetch-mock";
import { cachedHints, type HintsInput } from "~/features/chat/hints";
import { GRAMMAR_REV_KEY, grammarRev } from "~/features/grammar/grammar-api";
import { sharedTtsCache } from "~/features/chat/tts";
import { COMPOSER_MODE_KEY } from "~/features/chat/composer-mode";
import { PRACTICE_DRAFT_KEY, WORDBOOK_PREFS_KEY, clearDeviceData } from "./device-data";
import { PLAYBACK_RATE_KEY, getPlaybackRate, setPlaybackRate } from "~/lib/playback-rate";
import { kvGet, kvIdleForTests, kvSet } from "~/lib/kv-cache";

describe("clearDeviceData", () => {
  it("empties the practice draft, lookup cache and TTS blobs, and never throws", async () => {
    Object.assign(URL, { createObjectURL: vi.fn(() => "blob:x"), revokeObjectURL: vi.fn() });
    localStorage.setItem(PRACTICE_DRAFT_KEY, JSON.stringify("draft"));
    await kvSet("lookup", { a: 1 });
    localStorage.setItem(GRAMMAR_REV_KEY, "3");
    sharedTtsCache.set("k", new Blob(["a"]));
    setPlaybackRate(1.25);
    clearDeviceData();
    await vi.waitFor(async () => expect(await kvGet("lookup")).toBeUndefined());
    await kvIdleForTests();
    expect(localStorage.getItem(PRACTICE_DRAFT_KEY)).toBeNull();
    expect(localStorage.getItem(PLAYBACK_RATE_KEY)).toBeNull();
    expect(getPlaybackRate()).toBe(1);
    expect(localStorage.getItem(GRAMMAR_REV_KEY)).toBe("4"); // bumped (3 -> 4), never reset to 0
    expect(sharedTtsCache.get("k")).toBeUndefined();
    expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:x");
    vi.spyOn(Storage.prototype, "removeItem").mockImplementation(() => {
      throw new Error("denied");
    });
    expect(() => clearDeviceData()).not.toThrow();
    vi.restoreAllMocks();
  });

  it("logout bumps the grammar revision so stale entries from an unfinished kvClear cannot be hit again", () => {
    localStorage.removeItem(GRAMMAR_REV_KEY);
    clearDeviceData();
    expect(grammarRev()).toBe(1);
    clearDeviceData();
    expect(grammarRev()).toBe(2);
  });

  it("forgets in-memory hints of unsaved replies at logout", async () => {
    const replies = { replies: [1, 2, 3].map((i) => ({ text: `Reply ${i}.`, zh: `回复 ${i}` })) };
    const mock = createFetchMock({ "POST /api/ai/chat/completions": () => json({ choices: [{ message: { content: JSON.stringify(replies) } }] }) });
    const api = new ApiClient({ getToken: () => "t", fetchImpl: mock.fetch });
    const input: HintsInput = { conversationId: "c1", anchor: { key: "a-1" }, level: "auto", scenarioId: null, messages: [] };
    await cachedHints(api, input);
    await cachedHints(api, input);
    expect(mock.calls).toHaveLength(1);
    clearDeviceData();
    await cachedHints(api, input);
    expect(mock.calls).toHaveLength(2);
  });

  it("forgets the wordbook preferences at logout", () => {
    localStorage.setItem(WORDBOOK_PREFS_KEY, JSON.stringify({ showLetterCount: true }));
    clearDeviceData();
    expect(localStorage.getItem(WORDBOOK_PREFS_KEY)).toBeNull();
  });

  it("forgets the composer mode (text / hold to talk) at logout", () => {
    localStorage.setItem(COMPOSER_MODE_KEY, "voice");
    clearDeviceData();
    expect(localStorage.getItem(COMPOSER_MODE_KEY)).toBeNull();
  });

  it("clears cached grammar results with the rest of the kv cache", async () => {
    await kvSet("grammar:v1:0:\"She don't.\"", { hasErrors: false, corrected: "x", errors: [] });
    clearDeviceData();
    await vi.waitFor(async () => expect(await kvGet("grammar:v1:0:\"She don't.\"")).toBeUndefined());
  });
});
