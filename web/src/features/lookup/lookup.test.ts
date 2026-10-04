import "fake-indexeddb/auto";
import { beforeEach, describe, expect, it } from "vitest";
import { ApiClient } from "~/api/client";
import { resetKvCacheForTests } from "~/lib/kv-cache";
import { createFetchMock, json } from "~/test/fetch-mock";
import {
  cachedLookup,
  cachedTranslate,
  classifySelection,
  lookupCacheKey,
  lookupWord,
  parseLookupJson,
  translateCacheKey,
  translateText,
} from "./lookup";

const reply = (content: string) => () => json({ choices: [{ message: { content } }] });
const mk = (content: string) => {
  const mock = createFetchMock({ "POST /api/ai/chat/completions": reply(content) });
  return { mock, api: new ApiClient({ getToken: () => "t", fetchImpl: mock.fetch }) };
};

describe("lookup", () => {
  beforeEach(() => {
    indexedDB.deleteDatabase("enjoy-web");
    resetKvCacheForTests();
  });

  it.each([
    ["country", "lookup"],
    ["  look   up ", "lookup"],
    ["ask not what", "lookup"],
    ["ask not what your", "translate"],
    ["x".repeat(41), "translate"],
    ["   ", null],
  ] as const)("classifySelection(%j) = %s", (text, mode) => expect(classifySelection(text)).toBe(mode));

  it("asks the AI dictionary in JSON mode with the desktop prompt", async () => {
    const mock = createFetchMock({
      "POST /api/ai/chat/completions": reply(
        '```json\n{"word":"country","pos":"noun","definition":"a nation","translation":"国家","context_translation":"不要问国家"}\n```',
      ),
    });
    const api = new ApiClient({ getToken: () => "t", fetchImpl: mock.fetch });
    const result = await lookupWord(api, { word: "country", context: "ask not what your country can do", nativeLanguage: "zh-CN" });
    expect(result).toEqual({
      word: "country", lemma: "", pronunciation: "", pos: "noun", definition: "a nation", translation: "国家", contextTranslation: "不要问国家",
    });
    const body = JSON.parse(mock.calls[0].body as string);
    expect(body).toMatchObject({ temperature: 0, stream: false, response_format: { type: "json_object" } });
    expect(body.model).toBeUndefined();
    expect(body.messages[0].content).toContain("You are an English (United States)-普通话 dictionary.");
    expect(JSON.parse(body.messages[1].content)).toEqual({ word: "country", context: "ask not what your country can do" });
  });

  it("rejects malformed dictionary output with a typed error", () => {
    expect(() => parseLookupJson("not json")).toThrow("Invalid dictionary response");
    for (const bad of ["null", "[1]", '"str"', "42", "", "{"]) {
      let status: number | undefined;
      try {
        parseLookupJson(bad);
      } catch (e) {
        status = (e as { status?: number }).status;
      }
      expect(status, bad).toBe(502);
    }
  });

  it("parses defensively: prose around JSON, missing and non-string fields", () => {
    expect(parseLookupJson('Sure! Here:\n{"word":"a","definition":5,"pos":" noun "} hope it helps').pos).toBe("noun");
    expect(parseLookupJson('{"word":"a","definition":5}')).toMatchObject({ word: "a", definition: "", translation: "" });
  });

  it("translates with the desktop translation prompt", async () => {
    const { mock, api } = mk("  你好  ");
    expect(await translateText(api, { text: "Hello", nativeLanguage: "zh-CN" })).toBe("你好");
    const body = JSON.parse(mock.calls[0].body as string);
    expect(body.response_format).toBeUndefined();
    expect(body.messages).toEqual([
      { role: "system", content: "You are a professional, authentic translation engine, only returns translations." },
      { role: "user", content: "Translate the text to 普通话 Language, please do not explain my original text.:\n\nHello\n" },
    ]);
  });

  it("caches lookups in IndexedDB", async () => {
    const { mock, api } = mk('{"word":"country","definition":"a nation"}');
    const params = { word: "Country", context: "your country", nativeLanguage: "zh-CN" };
    await cachedLookup(api, params);
    expect((await cachedLookup(api, { ...params, word: "country" })).definition).toBe("a nation");
    expect(mock.calls).toHaveLength(1);
  });

  it("does not collide across contexts or languages", async () => {
    const { mock, api } = mk('{"word":"w","definition":"d"}');
    const base = { word: "bank", context: "river bank", nativeLanguage: "zh-CN" };
    await cachedLookup(api, base);
    await cachedLookup(api, { ...base, context: "money bank" });
    await cachedLookup(api, { ...base, nativeLanguage: "ja" });
    expect(mock.calls).toHaveLength(3);
    expect(lookupCacheKey("a:b", "c", "d")).not.toBe(lookupCacheKey("a", "b:c", "d"));
    expect(translateCacheKey("x", "zh-CN")).not.toBe(translateCacheKey("x", "ja"));
  });

  it("dedupes concurrent identical requests", async () => {
    const { mock, api } = mk('{"word":"w","definition":"d"}');
    const p = { word: "w", context: "c", nativeLanguage: "zh-CN" };
    await Promise.all([cachedLookup(api, p), cachedLookup(api, p)]);
    expect(mock.calls).toHaveLength(1);
    const t = mk("你好");
    const tp = { text: "Hello", nativeLanguage: "zh-CN" };
    await Promise.all([cachedTranslate(t.api, tp), cachedTranslate(t.api, tp)]);
    expect(t.mock.calls).toHaveLength(1);
  });

  it("does not cache failures or empty dictionary answers", async () => {
    const bad = mk("garbage");
    const p = { word: "w", context: "", nativeLanguage: "zh-CN" };
    await expect(cachedLookup(bad.api, p)).rejects.toMatchObject({ status: 502 });
    await expect(cachedLookup(bad.api, p)).rejects.toBeTruthy();
    expect(bad.mock.calls).toHaveLength(2);
    const empty = mk('{"word":"w","definition":"","translation":""}');
    await cachedLookup(empty.api, { ...p, word: "e" });
    await cachedLookup(empty.api, { ...p, word: "e" });
    expect(empty.mock.calls).toHaveLength(2);
  });

  it("truncates long text to 1000 chars and supports abort", async () => {
    const { mock, api } = mk("ok");
    await cachedTranslate(api, { text: "y".repeat(1500), nativeLanguage: "zh-CN" });
    expect((JSON.parse(mock.calls[0].body as string).messages[1].content as string).length).toBeLessThan(1200);
    const ctl = new AbortController();
    ctl.abort();
    await expect(cachedTranslate(api, { text: "other", nativeLanguage: "zh-CN" }, ctl.signal)).rejects.toMatchObject({ name: "AbortError" });
  });

  it("aborting one of two concurrent identical lookups rejects only that caller", async () => {
    const { mock, api } = mk('{"word":"w","definition":"d"}');
    const p = { word: "w", context: "c", nativeLanguage: "zh-CN" };
    const ctl = new AbortController();
    const aborted = cachedLookup(api, p, ctl.signal);
    const other = cachedLookup(api, p);
    ctl.abort();
    await expect(aborted).rejects.toMatchObject({ name: "AbortError" });
    expect((await other).definition).toBe("d");
    expect(mock.calls).toHaveLength(1);
  });
});
