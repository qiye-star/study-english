import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { expect, it } from "vitest";
import { mentionsAgent } from "./mentions";

const here = path.dirname(fileURLToPath(import.meta.url));
const F = JSON.parse(readFileSync(path.resolve(here, "../../../../../server/tests/fixtures/room_agent_mentions.json"), "utf8")) as {
  names: string[]; cases: { text: string; index: number | null; question: string }[] };

it.each(F.cases)("mentionsAgent($text) mirrors the server", ({ text, index, question }) => {
  expect(mentionsAgent(text, F.names)).toEqual({ index, question });
});
