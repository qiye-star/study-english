import { expect, test } from "@playwright/test";
import { signIn } from "./support/auth";
import { mockUpstreams } from "./support/mock-upstreams";

// 背单词主流程(计划 2026-10-10-wordbook Z1):E2E 栈需 WORDBOOK_ENABLED=true(docker-compose.e2e.yml),
// AI 讲解不开(WORDBOOK_AI_ENABLED 默认 false);整场零上游:守卫只放行 /api/wordbook/* 的数据库路径,朗读被模拟。
test.use({ locale: "zh-CN" }); // 断言用中文文案

test("wordbook: pick a book -> learn 5 words -> spelling -> 我的 row", async ({ page, request }) => {
  const upstreams = await mockUpstreams(page);
  await signIn(page, request);

  // 练习页大卡 → 选择词书 → 初中 → 开始
  const card = page.getByTestId("wordbook-card");
  await expect(card).toContainText("背单词");
  await card.getByRole("link", { name: "选择词书" }).click();
  await expect(page).toHaveURL(/\/wordbook\/books$/);
  await page.getByTestId("wordbook-book-junior").click();
  await page.getByRole("button", { name: "开始" }).click();
  await expect(page).toHaveURL(/\/wordbook$/);
  await expect(page.getByTestId("wordbook-action-learn")).toBeVisible();
  await expect(page.getByText("0 / 20")).toBeVisible(); // 今日新词 0 / 20

  // 学新词:5 张词卡逐张「下一个」,最后一张「开始小测」
  await page.getByTestId("wordbook-action-learn").click();
  for (let i = 0; i < 5; i++) {
    await expect(page.getByTestId("word-card")).toBeVisible();
    await page.getByRole("button", { name: i < 4 ? "下一个" : "开始小测" }).click();
  }
  // 小测:先选第一个选项;答错时记下标绿的正确项,词回到队尾再出现时选它
  const correct = new Map<string, string>();
  const summary = page.getByTestId("session-summary");
  const question = page.getByTestId("choice-question");
  for (let guard = 0; guard < 20; guard++) {
    await expect(question.or(summary)).toBeVisible();
    if (await summary.isVisible()) break;
    const word = (await question.getByTestId("question-word").textContent()) ?? "";
    const known = correct.get(word);
    await (known ? question.getByRole("button", { name: known, exact: true }) : question.locator("li button").first()).click();
    const right = question.locator('button[data-state="correct"]');
    await expect(right).toBeVisible();
    correct.set(word, ((await right.textContent()) ?? "").trim());
    await page.getByRole("button", { name: "继续" }).click();
  }
  await expect(summary).toContainText("学会 5 个新词");

  // 回首页:新词 5 / 20;练习页大卡「新词还剩 15」
  await page.getByRole("button", { name: "回到首页" }).click();
  await expect(page).toHaveURL(/\/wordbook$/);
  await expect(page.getByText("5 / 20")).toBeVisible();
  await page.goto("/practice");
  await expect(page.getByTestId("wordbook-card")).toContainText("新词还剩 15");

  // 按句拼写:有句组就逐空填写并提交,出现得分(role=status);没有句组时提示先学新词,也算通过
  await page.goto("/wordbook/spell");
  const spellPage = page.getByTestId("wordbook-spell-page");
  await expect(spellPage).toBeVisible();
  const empty = page.getByText("先学几个新词再来拼写");
  const input = spellPage.locator("form input"); // 唯一的隐藏输入框;aria-label 随当前空变化(第 n 空,共 m 空)
  await expect(empty.or(input)).toBeVisible();
  if (await input.isVisible()) {
    const total = Number((await input.getAttribute("aria-label"))?.match(/共 (\d+) 空/)?.[1] ?? 0);
    for (let i = 0; i < total; i++) await input.pressSequentially(i + 1 < total ? "word " : "word");
    await page.getByRole("button", { name: "提交" }).click();
    await expect(page.getByRole("status").first()).toContainText(/\d/);
  }

  // 「我的」页有「背单词」行
  await page.goto("/me");
  await expect(page.getByTestId("me-wordbook")).toContainText("背单词");
  expect(upstreams.unmocked).toEqual([]);
});
