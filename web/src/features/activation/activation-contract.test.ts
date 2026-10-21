import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import camelcaseKeys from "camelcase-keys";
import { describe, expect, it } from "vitest";
import { parseWords } from "./activation-api";

/** 契约(计划 L4 Task 15):服务端 tests/fixtures/activation_contract.json 由服务端对真实应用录制;这里逐键核对网页类型。 */
const here = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE = path.resolve(here, "../../../../server/tests/fixtures/activation_contract.json");
const raw = JSON.parse(readFileSync(FIXTURE, "utf8")) as Record<string, unknown>;
// ApiClient camel-cases every response key before the feature sees it; the contract test does the same
const camel = (v: unknown) => camelcaseKeys(v as Record<string, unknown>, { deep: true }) as Record<string, unknown>;
const keysOf = (o: object) => Object.keys(o).sort();

describe("activation contract", () => {
  it("config is exactly { enabled }", () => {
    expect(keysOf(camel(raw.config as object))).toEqual(["enabled"]);
  });

  it("a words page has the keys the parser reads", () => {
    for (const name of ["words_dormant", "words_active"]) {
      const page = camel(raw[name] as object);
      expect(keysOf(page)).toEqual(["counts", "items", "nextPage", "state"]);
      expect(keysOf(page.counts as object)).toEqual(["active", "dormant", "sprouting"]);
      for (const item of page.items as object[]) {
        expect(keysOf(item)).toEqual(["bookId", "lastUsedAt", "learnedAt", "useCount", "word"]);
      }
    }
  });

  it("the parser reads the recorded pages without losing a word", () => {
    const dormant = parseWords(camel(raw.words_dormant as object));
    expect(dormant.items.map((w) => w.word)).toEqual(["talk"]);
    expect(dormant.counts).toEqual({ dormant: 1, sprouting: 0, active: 1 });
    const active = parseWords(camel(raw.words_active as object));
    expect(active.items[0]).toMatchObject({ word: "walk", useCount: 2 });
  });

  it("the prompt hint has words and block", () => {
    const hint = camel(raw.prompt_hint as object);
    expect(keysOf(hint)).toEqual(["block", "words"]);
    expect(hint.words).toEqual(["talk"]);
    expect(typeof hint.block).toBe("string");
  });
});
