import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import camelcaseKeys from "camelcase-keys";
import { expect, it } from "vitest";
import type { AdoptResult, LinkCard } from "~/features/wordbook/link-actions";
import type { Card, ItemState } from "~/features/wordbook/wordbook-api";
// 静态导入本插件:让 vocabulary 等模块在收集阶段就编译好。否则 test/setup.ts 的 beforeEach 动态导入 ~/plugins/core
// 会在本文件里第一次冷编译整条依赖链,冷缓存时超过 10 秒钩子超时(本文件没有 vi.mock,静态导入无副作用)。
import "./index";

const here = path.dirname(fileURLToPath(import.meta.url));
const contract = JSON.parse(readFileSync(path.resolve(here, "../../../../server/tests/fixtures/links_word_actions_contract.json"), "utf8"));
const ADOPT: Record<keyof AdoptResult, true> = { status: true, bookId: true };
const LINK_CARD: Record<keyof LinkCard, true> = { bookId: true, card: true, item: true };
// defsEn is optional (absent = no English definitions): excluded from the exact key set (definitions plan R-DW11)
const CARD: Record<Exclude<keyof Card, "defsEn">, true> = { key: true, word: true, us: true, uk: true, senses: true, phrases: true, examples: true };
const ITEM: Record<keyof ItemState, true> = { box: true, dueAt: true };
const keys = (o: object) => Object.keys(o).sort();

it("matches the server's /api/links/wordbook/adopt and /card shapes (P-L6)", () => {
  const adopt = camelcaseKeys(contract.adopt, { deep: true }) as AdoptResult;
  expect(keys(adopt)).toEqual(keys(ADOPT));
  expect(["added", "known", "not_in_book"]).toContain(adopt.status);
  const card = camelcaseKeys(contract.card, { deep: true }) as LinkCard;
  expect(keys(card)).toEqual(keys(LINK_CARD));
  expect(keys(card.card).filter((k) => k !== "defsEn")).toEqual(keys(CARD));
  expect(keys(card.item!)).toEqual(keys(ITEM));
  expect(contract.missing).toEqual({ error: "Word not found" });
});
