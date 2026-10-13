import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import camelcaseKeys from "camelcase-keys";
import { describe, expect, it } from "vitest";
import { parseDictionaryResponse } from "./dictionary";

/** 契约(计划 B R-L7):`server/tests/fixtures/dictionary_contract.json` 由服务端 `test_dictionary_contract.py` 录制,这里逐键核对网页解析。 */
const here = path.dirname(fileURLToPath(import.meta.url));
const contract = JSON.parse(readFileSync(path.resolve(here, "../../../../server/tests/fixtures/dictionary_contract.json"), "utf8")) as Record<string, Record<string, unknown>>;
const cc = (v: unknown) => camelcaseKeys(v as Record<string, unknown>, { deep: true });
const keys = (o: object) => Object.keys(o).sort();

describe("dictionary contract", () => {
  it("has the four recorded answers", () => {
    expect(keys(contract)).toEqual(["hit", "inflected", "miss", "phrase"]);
  });
  it("a headword hit parses with every wire key accounted for", () => {
    expect(keys(contract.hit)).toEqual(["def_lang", "defs_en", "defs_zh", "hit", "phonetic", "phrases", "source", "word"]);
    const parsed = parseDictionaryResponse(cc(contract.hit))!;
    expect(parsed.word).toBe("talk");
    expect(parsed.lemma).toBeUndefined();
    expect(parsed.defsZh.length).toBeGreaterThan(0);
    expect(parsed.defsEn.length).toBeGreaterThan(0);
    expect(parsed.phrases).toEqual([{ en: "talk about", zh: "谈论某事" }]);
    expect(["both", "zh", "en"]).toContain(parsed.defLang);
  });
  it("an inflected hit carries the lemma", () => {
    expect(keys(contract.inflected)).toEqual(["def_lang", "defs_en", "defs_zh", "hit", "lemma", "phonetic", "phrases", "source", "word"]);
    expect(parseDictionaryResponse(cc(contract.inflected))).toMatchObject({ word: "went", lemma: "go" });
  });
  it("a phrase hit has Chinese only and no phrases key", () => {
    expect(keys(contract.phrase)).toEqual(["def_lang", "defs_en", "defs_zh", "hit", "source", "word"]);
    const parsed = parseDictionaryResponse(cc(contract.phrase))!;
    expect(parsed.defsEn).toEqual([]);
    expect(parsed.defsZh).toEqual([{ pos: "", text: "能够" }]);
    expect(parsed.phrases).toEqual([]);
  });
  it("a miss is exactly {hit:false} and parses to null", () => {
    expect(contract.miss).toEqual({ hit: false });
    expect(parseDictionaryResponse(cc(contract.miss))).toBeNull();
  });
});
