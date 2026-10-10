import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import camelcaseKeys from "camelcase-keys";
import { expect, it } from "vitest";
import type { TodayWord, WeakWordItem, WeakWordsPage } from "./pron-api";

const here = path.dirname(fileURLToPath(import.meta.url));
const contract = JSON.parse(readFileSync(path.resolve(here, "../../../../server/tests/fixtures/links_pron_shadow_contract.json"), "utf8"));
const PAGE: Record<keyof WeakWordsPage, true> = { items: true, total: true };
const ITEM: Record<keyof WeakWordItem, true> = { word: true, hits: true, lastScore: true, lastWeakAt: true, example: true };
const TODAY: Record<keyof TodayWord, true> = { key: true, word: true, example: true };
const keys = (o: object) => Object.keys(o).sort();

it("matches the server's pron_shadow shapes", () => {
  const list = camelcaseKeys(contract.list, { deep: true }) as WeakWordsPage;
  expect(keys(list)).toEqual(keys(PAGE));
  expect(keys(list.items[0])).toEqual(keys(ITEM));
  expect(contract.dismiss).toEqual({ word: expect.any(String) });
  const today = camelcaseKeys(contract.today_words, { deep: true }) as { items: TodayWord[] };
  expect(keys(today)).toEqual(["items"]);
  expect(keys(today.items[0])).toEqual(keys(TODAY));
  expect(keys(today.items[0].example!)).toEqual(["en", "zh"]);
});
