import { readFileSync } from "node:fs";
import path from "node:path";
import { expect, test } from "@playwright/test";
import { signIn } from "./support/auth";
import { useFakeMicrophone } from "./support/fake-mic";
import { mockUpstreams } from "./support/mock-upstreams";
import { touchHold } from "./support/touch";

// 契约样例与服务端测试共用(server/tests/test_rank_api.py 对真实应用逐形状核对过)
const CONTRACT = JSON.parse(readFileSync(path.resolve(__dirname, "../../server/tests/fixtures/rank_contract.json"), "utf8"));

test.use({ locale: "zh-CN" }); // 断言用中文文案

test("rank home -> promotion match (mocked rank API) -> pass result", async ({ page, request, browserName }) => {
  await useFakeMicrophone(page, browserName);
  const upstreams = await mockUpstreams(page); // TTS of the AI line is mocked here
  const match = { ...CONTRACT.match, turn_limit: 1 };
  // 后注册的路由先匹配:这些覆盖守卫对 /api/rank/* 的放行,整场零上游
  await page.route("**/api/rank/config", (r) => r.fulfill({ json: CONTRACT.config }));
  await page.route("**/api/rank/me**", (r) => r.fulfill({ json: CONTRACT.me }));
  await page.route("**/api/rank/matches?**", (r) => r.fulfill({ json: { match } }));
  await page.route(`**/api/rank/matches/${match.id}`, (r) => r.fulfill({ json: { match, verdict: null } }));
  await page.route(`**/api/rank/matches/${match.id}/turns`, (r) => r.fulfill({ json: { ...CONTRACT.turn, ai_line: null, done: true } }));
  await page.route(`**/api/rank/matches/${match.id}/finish`, (r) => r.fulfill({ json: CONTRACT.finish_pass }));
  await signIn(page, request);

  await page.goto("/practice");
  await expect(page.getByTestId("rank-card")).toContainText("可以打晋级赛了");
  await page.getByTestId("rank-card").click();
  await page.getByTestId("rank-start").click();
  await expect(page).toHaveURL(new RegExp(`/rank/match/${match.id}$`));
  await page.getByTestId("match-begin").click();
  const hold = page.getByTestId("match-hold");
  await expect(hold).toBeEnabled({ timeout: 15_000 });
  await touchHold(page, hold, { ms: 2500 });
  await expect(page.getByTestId("match-result")).toHaveAttribute("data-passed", "true", { timeout: 20_000 });
  await expect(page.getByText("晋级成功")).toBeVisible();
  expect(upstreams.unmocked).toEqual([]);
});
