import { describe, expect, it } from "vitest";
import { ApiClient, ApiError } from "~/api/client";
import { createFetchMock, json } from "~/test/fetch-mock";
import { bareLookup, dictToLookup, enPosLabel, lookupDictionary, parseDictionaryResponse, visibleDefs, type DictEntry } from "./dictionary";

const HIT = {
  hit: true, word: "went", lemma: "go", phonetic: "ɡo", source: "dict", def_lang: "en",
  defs_zh: [{ pos: "v", text: "去;走" }], defs_en: [{ pos: "v", text: "move or travel to a place" }],
  phrases: [{ en: "go on", zh: "继续" }],
};
const api = (mock: ReturnType<typeof createFetchMock>) => new ApiClient({ getToken: () => "t", fetchImpl: mock.fetch });
const entry = (over: Partial<DictEntry> = {}): DictEntry => ({
  word: "go", defsZh: [{ pos: "v", text: "去" }], defsEn: [{ pos: "v", text: "move" }], phrases: [], defLang: "both", ...over,
});

describe("parseDictionaryResponse", () => {
  it("maps a hit (camel-cased by the client)", () => {
    const camel = { hit: true, word: "went", lemma: "go", phonetic: "ɡo", defsZh: HIT.defs_zh, defsEn: HIT.defs_en, phrases: HIT.phrases, defLang: "en" };
    expect(parseDictionaryResponse(camel)).toEqual({
      word: "went", lemma: "go", phonetic: "ɡo", defsZh: HIT.defs_zh, defsEn: HIT.defs_en, phrases: HIT.phrases, defLang: "en",
    });
  });
  it("treats misses and malformed answers as null", () => {
    for (const raw of <unknown[]>[null, undefined, "x", [], { hit: false }, { hit: true }, { hit: true, word: "a" }, { hit: true, word: "a", defsZh: [], defsEn: [] },
      { hit: true, word: "a", defsZh: [{ pos: "n", text: "  " }] }, { hit: "true", word: "a", defsZh: [{ text: "x" }] }]) {
      expect(parseDictionaryResponse(raw)).toBeNull();
    }
  });
  it("defaults the missing parts: no phrases, unknown def_lang means English only, at most three phrases", () => {
    const raw = { hit: true, word: "a", defsZh: [{ text: "甲" }], defLang: "fr", phrases: [{ en: "a", zh: "1" }, { en: "b", zh: "2" }, { en: "c", zh: "3" }, { en: "d", zh: "4" }, { zh: "x" }] };
    expect(parseDictionaryResponse(raw)).toEqual({ word: "a", defsZh: [{ pos: "", text: "甲" }], defsEn: [], defLang: "en",
      phrases: [{ en: "a", zh: "1" }, { en: "b", zh: "2" }, { en: "c", zh: "3" }] });
  });
});

describe("lookupDictionary", () => {
  it("posts the text in the body only, never in the URL, and parses the answer", async () => {
    const mock = createFetchMock({ "POST /api/dictionary/lookup": () => json(HIT) });
    const result = await lookupDictionary(api(mock), "  Went \n");
    expect(result?.lemma).toBe("go");
    expect(mock.calls).toHaveLength(1);
    expect(mock.calls[0].url.search).toBe("");
    expect(mock.calls[0].url.pathname).not.toContain("went");
    expect(JSON.parse(String(mock.calls[0].body))).toEqual({ text: "Went" });
  });
  it("returns null for a miss and rejects on errors (the caller falls back to the AI)", async () => {
    expect(await lookupDictionary(api(createFetchMock({ "POST /api/dictionary/lookup": () => json({ hit: false }) })), "zebra")).toBeNull();
    await expect(lookupDictionary(api(createFetchMock({ "POST /api/dictionary/lookup": () => json({ error: "Too many requests" }, 429) })), "zebra"))
      .rejects.toBeInstanceOf(ApiError);
    await expect(lookupDictionary(api(createFetchMock({})), "zebra")).rejects.toMatchObject({ status: 404 });
  });
  it("shares one in-flight request per word and does not remember results", async () => {
    let release: () => void = () => {};
    const mock = createFetchMock({ "POST /api/dictionary/lookup": () => new Promise((resolve) => { release = () => resolve(json(HIT)); }) });
    const a = lookupDictionary(api(mock), "went");
    const b = lookupDictionary(api(mock), "WENT");
    release();
    await Promise.all([a, b]);
    expect(mock.calls).toHaveLength(1);
    const again = lookupDictionary(api(mock), "went");
    release();
    await again;
    expect(mock.calls).toHaveLength(2);
  });
  it("lets a caller leave without cancelling the shared request", async () => {
    let release: () => void = () => {};
    const mock = createFetchMock({ "POST /api/dictionary/lookup": () => new Promise((resolve) => { release = () => resolve(json(HIT)); }) });
    const ctl = new AbortController();
    const left = lookupDictionary(api(mock), "went", ctl.signal);
    ctl.abort();
    await expect(left).rejects.toMatchObject({ name: "AbortError" });
    release();
  });
});

describe("visibleDefs (spec D2)", () => {
  it("both shows both, zh shows Chinese only, en shows English only", () => {
    expect(visibleDefs(entry({ defLang: "both" }))).toEqual({ zh: entry().defsZh, en: entry().defsEn });
    expect(visibleDefs(entry({ defLang: "zh" }))).toEqual({ zh: entry().defsZh, en: [] });
    expect(visibleDefs(entry({ defLang: "en" }))).toEqual({ zh: [], en: entry().defsEn });
  });
  it("English only falls back to Chinese when there is no English definition", () => {
    expect(visibleDefs(entry({ defLang: "en", defsEn: [] }))).toEqual({ zh: entry().defsZh, en: [] });
  });
  it("shows whatever exists when the preferred side is empty", () => {
    expect(visibleDefs(entry({ defLang: "zh", defsZh: [] }))).toEqual({ zh: [], en: entry().defsEn });
  });
});

describe("mapping helpers", () => {
  it("dictToLookup builds the meaning parts the add button uses", () => {
    const lookup = dictToLookup(entry({ word: "went", lemma: "go", phonetic: "ɡo", defsZh: [{ pos: "v", text: "去" }, { pos: "n", text: "走" }, { pos: "", text: "三" }] }));
    expect(lookup).toEqual({ word: "went", lemma: "go", pronunciation: "ɡo", pos: "", definition: "move", translation: "v. 去；n. 走", contextTranslation: "" });
  });
  it("labels English POS codes and passes unknown ones through", () => {
    expect(enPosLabel("a")).toBe("adj."); expect(enPosLabel("r")).toBe("adv."); expect(enPosLabel("zz")).toBe("zz");
  });
  it("bareLookup carries only the word", () => {
    expect(bareLookup("go")).toMatchObject({ word: "go", definition: "", translation: "" });
  });
});
