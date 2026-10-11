import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import camelcaseKeys from "camelcase-keys";
import { expect, it } from "vitest";
import type { ChatWords, ChatWordsItem } from "./chat-words-api";

const here = path.dirname(fileURLToPath(import.meta.url));
const contract = JSON.parse(readFileSync(path.resolve(here, "../../../../server/tests/fixtures/links_chat_words_contract.json"), "utf8"));
const BODY: Record<keyof ChatWords, true> = { today: true, usedCount: true };
const ITEM: Record<keyof ChatWordsItem, true> = { word: true, used: true };

it("matches the server's /api/links/chat-words shape", () => {
  const body = camelcaseKeys(contract.chat_words, { deep: true }) as ChatWords;
  expect(Object.keys(body).sort()).toEqual(Object.keys(BODY).sort());
  expect(Object.keys(body.today[0]).sort()).toEqual(Object.keys(ITEM).sort());
  expect(typeof body.usedCount).toBe("number");
  expect(typeof body.today[0].used).toBe("boolean");
});
