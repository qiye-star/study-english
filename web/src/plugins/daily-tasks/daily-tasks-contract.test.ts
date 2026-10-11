import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import camelcaseKeys from "camelcase-keys";
import { expect, it } from "vitest";
import type { TodayCounts } from "~/lib/extension-points";

const here = path.dirname(fileURLToPath(import.meta.url));
const contract = JSON.parse(readFileSync(path.resolve(here, "../../../../server/tests/fixtures/links_daily_tasks_contract.json"), "utf8"));
const TODAY: Record<keyof TodayCounts, true> = { practiceToday: true, chatMessagesToday: true, conversationsToday: true };

it("matches the server's /api/links/today shape", () => {
  const body = camelcaseKeys(contract.today, { deep: true }) as TodayCounts;
  expect(Object.keys(body).sort()).toEqual(Object.keys(TODAY).sort());
  for (const value of Object.values(body)) expect(typeof value).toBe("number");
});
