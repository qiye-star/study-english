import { describe, expect, it } from "vitest";
import { ApiClient } from "~/api/client";
import { createFetchMock, json, type Handler } from "~/test/fetch-mock";
import { fetchActivationConfig, fetchPromptHint, fetchWords, parseWords } from "./activation-api";

function clientFor(routes: Record<string, Handler>) {
  const mock = createFetchMock(routes);
  return { mock, api: new ApiClient({ getToken: () => "t", fetchImpl: mock.fetch }) };
}

const WORD: Record<string, unknown> = { word: "talk", book_id: "junior", learned_at: "2026-09-11T12:00:00+00:00", last_used_at: null, use_count: 0 };

describe("parseWords", () => {
  it("maps the camelCased page and drops malformed words", () => {
    const page = parseWords({
      state: "dormant",
      items: [{ word: "talk", bookId: "junior", learnedAt: "2026-09-11", lastUsedAt: null, useCount: 0 },
              { bookId: "junior" }, null, { word: "", bookId: "x" }],
      counts: { dormant: 3, sprouting: 1, active: 0 },
      nextPage: 1,
    });
    expect(page.state).toBe("dormant");
    expect(page.items).toEqual([{ word: "talk", bookId: "junior", learnedAt: "2026-09-11", lastUsedAt: null, useCount: 0 }]);
    expect(page.counts).toEqual({ dormant: 3, sprouting: 1, active: 0 });
    expect(page.next).toBe(1);
  });

  it("treats a missing or odd body as an empty page", () => {
    expect(parseWords(null)).toEqual({ state: "dormant", items: [], counts: { dormant: 0, sprouting: 0, active: 0 }, next: null });
    expect(parseWords({ state: "nonsense", counts: { dormant: -4 } }).counts.dormant).toBe(0);
  });
});

describe("activation api calls", () => {
  it("fetchWords sends only the state and page in the query string", async () => {
    const { api, mock } = clientFor({
      "GET /api/activation/words": () => json({ state: "sprouting", items: [WORD], counts: { dormant: 0, sprouting: 1, active: 0 }, next_page: null }),
    });
    const page = await fetchWords(api, "sprouting", 2);
    expect(page.items[0].word).toBe("talk");
    const url = mock.calls[0].url;
    expect([...url.searchParams.keys()].sort()).toEqual(["page", "state"]);
    expect(url.searchParams.get("state")).toBe("sprouting");
    expect(url.searchParams.get("page")).toBe("2");
  });

  it("fetchActivationConfig is enabled only when the server says so", async () => {
    const on = clientFor({ "GET /api/activation/config": () => json({ enabled: true }) });
    expect(await fetchActivationConfig(on.api)).toEqual({ enabled: true });
    const off = clientFor({ "GET /api/activation/config": () => json({}) });
    expect(await fetchActivationConfig(off.api)).toEqual({ enabled: false });
  });

  it("fetchPromptHint returns the words and the instruction, or nothing", async () => {
    const hit = clientFor({
      "GET /api/activation/prompt-hint": () => json({ words: ["talk"], block: "Words the learner knows but has not used yet: talk." }),
    });
    expect(await fetchPromptHint(hit.api, 0)).toEqual({ words: ["talk"], block: "Words the learner knows but has not used yet: talk." });
    const miss = clientFor({ "GET /api/activation/prompt-hint": () => json({ words: [], block: null }) });
    expect(await fetchPromptHint(miss.api, 0)).toEqual({ words: [], block: null });
  });

  it("a failed call rejects, so the page can show its own message", async () => {
    const { api } = clientFor({ "GET /api/activation/words": () => json({ error: "Activation is off" }, 404) });
    await expect(fetchWords(api, "dormant", 0)).rejects.toBeTruthy();
  });
});
