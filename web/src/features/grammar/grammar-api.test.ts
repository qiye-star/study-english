import "fake-indexeddb/auto";
import { beforeEach, describe, expect, it } from "vitest";
import i18n from "~/i18n";
import { ApiClient, ApiError } from "~/api/client";
import { translateServerError } from "~/api/error-messages";
import { kvGet, resetKvCacheForTests } from "~/lib/kv-cache";
import { createFetchMock, json } from "~/test/fetch-mock";
import { GRAMMAR_SERVER_ERRORS, bumpGrammarRev, cachedGrammar, checkGrammar, grammarCacheKey, grammarRev } from "./grammar-api";

const SERVER = { has_errors: true, corrected: "She doesn't like it.", errors: [{ original: "don't", corrected: "doesn't", category: "agreement", explanation: "三单" }] };
const CLIENT = { hasErrors: true, corrected: "She doesn't like it.", errors: [{ original: "don't", corrected: "doesn't", category: "agreement", explanation: "三单" }] };

describe("grammar api", () => {
  beforeEach(() => { indexedDB.deleteDatabase("enjoy-web"); resetKvCacheForTests(); localStorage.clear(); });

  it("posts the text with the last 500 context characters", async () => {
    const mock = createFetchMock({ "POST /api/ai/grammar": () => json(SERVER) });
    const api = new ApiClient({ getToken: () => "t", fetchImpl: mock.fetch });
    expect(await checkGrammar(api, { text: "She don't like it.", context: "a".repeat(100) + "b".repeat(500) })).toEqual(CLIENT);
    expect(JSON.parse(mock.calls[0].body as string)).toEqual({ text: "She don't like it.", context: "b".repeat(500) });
    await checkGrammar(api, { text: "She don't like it." });
    expect(JSON.parse(mock.calls[1].body as string)).toEqual({ text: "She don't like it." });
  });

  it("caches by text and prompt revision", async () => {
    const mock = createFetchMock({ "POST /api/ai/grammar": () => json(SERVER) });
    const api = new ApiClient({ getToken: () => "t", fetchImpl: mock.fetch });
    await cachedGrammar(api, { text: "She don't like it." });
    expect(await cachedGrammar(api, { text: "She  don't like it. " })).toEqual(CLIENT);
    expect(mock.calls).toHaveLength(1);
    expect(grammarRev()).toBe(0);
    bumpGrammarRev();
    expect(grammarRev()).toBe(1);
    await cachedGrammar(api, { text: "She don't like it." });
    expect(mock.calls).toHaveLength(2);
  });

  it("does not cache failures", async () => {
    let fail = true;
    const mock = createFetchMock({ "POST /api/ai/grammar": () => (fail ? json({ error: "Upstream unavailable" }, 502) : json(SERVER)) });
    const api = new ApiClient({ getToken: () => "t", fetchImpl: mock.fetch });
    await expect(cachedGrammar(api, { text: "She don't like it." })).rejects.toBeInstanceOf(ApiError);
    fail = false;
    expect(await cachedGrammar(api, { text: "She don't like it." })).toEqual(CLIENT);
  });

  it("maps every grammar server error to localized text", () => {
    const t = i18n.getFixedT("zh-CN");
    for (const message of Object.keys(GRAMMAR_SERVER_ERRORS)) {
      expect(translateServerError(t, new ApiError(502, message), GRAMMAR_SERVER_ERRORS)).not.toBe(t("web.errors.unknown"));
    }
    const en = i18n.getFixedT("en");
    for (const message of Object.keys(GRAMMAR_SERVER_ERRORS)) {
      expect(translateServerError(en, new ApiError(502, message), GRAMMAR_SERVER_ERRORS)).not.toBe(en("web.errors.unknown"));
    }
  });

  it("rejects malformed responses without caching them", async () => {
    let body: unknown = { has_errors: "yes", corrected: 1 };
    const mock = createFetchMock({ "POST /api/ai/grammar": () => json(body) });
    const api = new ApiClient({ getToken: () => "t", fetchImpl: mock.fetch });
    await expect(cachedGrammar(api, { text: "She don't like it." })).rejects.toBeInstanceOf(ApiError);
    expect(await kvGet(grammarCacheKey("She don't like it."))).toBeUndefined();
    body = SERVER;
    expect(await cachedGrammar(api, { text: "She don't like it." })).toEqual(CLIENT);
  });

  it("skips blank and over-long text without calling the server", async () => {
    const mock = createFetchMock({ "POST /api/ai/grammar": () => json(SERVER) });
    const api = new ApiClient({ getToken: () => "t", fetchImpl: mock.fetch });
    await expect(checkGrammar(api, { text: "   " })).rejects.toMatchObject({ status: 400 });
    await expect(cachedGrammar(api, { text: "a".repeat(2001) })).rejects.toMatchObject({ status: 413 });
    expect(mock.calls).toHaveLength(0);
  });

  it("separates cache entries by context", async () => {
    const mock = createFetchMock({ "POST /api/ai/grammar": () => json(SERVER) });
    const api = new ApiClient({ getToken: () => "t", fetchImpl: mock.fetch });
    await cachedGrammar(api, { text: "She don't like it.", context: "A" });
    await cachedGrammar(api, { text: "She don't like it.", context: "B" });
    await cachedGrammar(api, { text: "She don't like it.", context: "A" });
    expect(mock.calls).toHaveLength(2);
  });

  it("dedupes concurrent calls and one caller's abort does not cancel the others", async () => {
    const mock = createFetchMock({ "POST /api/ai/grammar": async () => { await new Promise((r) => setTimeout(r, 20)); return json(SERVER); } });
    const api = new ApiClient({ getToken: () => "t", fetchImpl: mock.fetch });
    const ac = new AbortController();
    const a = cachedGrammar(api, { text: "She don't like it." }, ac.signal);
    const b = cachedGrammar(api, { text: "She don't like it." });
    ac.abort();
    await expect(a).rejects.toMatchObject({ name: "AbortError" });
    expect(await b).toEqual(CLIENT);
    expect(mock.calls).toHaveLength(1);
  });
});
