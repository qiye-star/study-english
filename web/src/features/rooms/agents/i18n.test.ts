import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { expect, it } from "vitest";
import { ROOM_AGENTS_SERVER_ERRORS } from "./room-agents-api";

type Dict = Record<string, unknown>;
const here = path.dirname(fileURLToPath(import.meta.url));
const load = (lng: string) => JSON.parse(readFileSync(path.join(here, "i18n", `${lng}.json`), "utf8")) as Dict;
const flat = (o: Dict, prefix = ""): string[] => Object.entries(o).flatMap(([k, v]) =>
  v && typeof v === "object" ? flat(v as Dict, `${prefix}${k}.`) : [`${prefix}${k}`]);
const get = (o: Dict, key: string) => key.split(".").reduce<unknown>((cur, k) => (cur as Dict | undefined)?.[k], o);

it("zh-CN and en have exactly the same keys", () => {
  expect(flat(load("en")).sort()).toEqual(flat(load("zh-CN")).sort());
});

it("every room-agents server error has copy in both languages", () => {
  for (const lng of ["en", "zh-CN"]) {
    for (const key of Object.values(ROOM_AGENTS_SERVER_ERRORS)) expect(get(load(lng), key), `${lng} ${key}`).toEqual(expect.any(String));
  }
});
