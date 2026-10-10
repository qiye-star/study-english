import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import camelcaseKeys from "camelcase-keys";
import { expect, it } from "vitest";
import { LINK_KEYS } from "~/lib/extension-points";
import type { LinkItem, LinksConfig } from "./links-api";

const here = path.dirname(fileURLToPath(import.meta.url));
const contract = JSON.parse(readFileSync(path.resolve(here, "../../../../server/tests/fixtures/links_contract.json"), "utf8"));
const CONFIG: Record<keyof LinksConfig, true> = { enabled: true, links: true };
const ITEM: Record<keyof LinkItem, true> = { key: true, global: true, user: true, effective: true };

it("matches the server's /api/links/config and /prefs shapes", () => {
  for (const name of ["config", "prefs"]) {
    const body = camelcaseKeys(contract[name], { deep: true }) as LinksConfig;
    expect(Object.keys(body).sort()).toEqual(Object.keys(CONFIG).sort());
    expect(Object.keys(body.links[0]).sort()).toEqual(Object.keys(ITEM).sort());
    expect(body.links.map((l) => l.key)).toEqual([...LINK_KEYS]);
  }
  expect(contract.unknown).toEqual({ error: "Unknown link" });
});
