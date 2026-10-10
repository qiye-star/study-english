import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import camelcaseKeys from "camelcase-keys";
import { expect, it } from "vitest";
import type { MistakeItem, MistakesPageData } from "./mistakes-api";

const here = path.dirname(fileURLToPath(import.meta.url));
const contract = JSON.parse(readFileSync(path.resolve(here, "../../../../server/tests/fixtures/links_mistakes_contract.json"), "utf8"));
const PAGE: Record<keyof MistakesPageData, true> = { items: true, next: true, total: true };
const ITEM: Record<keyof MistakeItem, true> = {
  word: true, wrongCount: true, lastWrongAt: true, meaning: true, box: true, dueAt: true, bookId: true,
};

it("matches the server's /api/links/mistakes and /dismiss shapes", () => {
  const list = camelcaseKeys(contract.list, { deep: true }) as MistakesPageData;
  expect(Object.keys(list).sort()).toEqual(Object.keys(PAGE).sort());
  expect(Object.keys(list.items[0]).sort()).toEqual(Object.keys(ITEM).sort());
  expect(Object.keys(contract.dismiss)).toEqual(["word"]);
});
