import { expect, test, type Page } from "@playwright/test";
import { signIn } from "./support/auth";
import { mockUpstreams } from "./support/mock-upstreams";

// 学习联动(计划 2026-10-11-learning-links Z1):栈 LINKS_ENABLED=true、WORDBOOK_ENABLED=true(docker-compose.e2e.yml)。
// 整场零上游:不评测、不调大模型(对话用词的大模型检查默认关),只走 /api/links/* 与 /api/wordbook/* 的数据库路径。
// 与计划 Step 2 的差异:「更多」面板在易错词页的词行上打开(同一个 wordActions 插槽);查词浮层要大模型查词,零上游下不走。
test.use({ locale: "zh-CN" });

type Sense = { pos: string; text: string };
type Card = { key: string; word: string; senses: Sense[] };
type Question = { key: string; qtype: string; prompt: { word?: string; meaning?: string }; options: string[] | null };
type Batch = { book_id: string; cards: Card[]; quiz: Question[]; drill: Question[] };

/** 与服务端 entry.meaning_line 相同:前两个义项,24 字截断(选择题正确项原文)。 */
function meaningLine(card: Card, max = 24): string {
  const line = card.senses.slice(0, 2).map((s) => (s.pos ? `${s.pos}. ${s.text}` : s.text)).join("；");
  return line.length <= max ? line : `${line.slice(0, max - 1)}…`;
}

/** 当前小测题的正确项与题面词(看释义选词时由释义反查)。 */
async function currentQuestion(page: Page, batch: Batch): Promise<{ word: string; answer: string }> {
  const question = page.getByTestId("choice-question");
  const word = question.getByTestId("question-word");
  if (await word.count()) {
    const text = ((await word.textContent()) ?? "").trim();
    return { word: text, answer: meaningLine(batch.cards.find((c) => c.word === text)!) };
  }
  const meaning = ((await question.getByTestId("question-meaning").textContent()) ?? "").trim();
  const card = batch.cards.find((c) => meaningLine(c) === meaning || c.senses.some((s) => meaning.includes(s.text)))!;
  return { word: card.word, answer: card.word };
}

test("learning links: daily tasks, mistakes view, word actions menu and the per-user switch", async ({ page, request }) => {
  const upstreams = await mockUpstreams(page);
  const creds = await signIn(page, request);
  const auth = { Authorization: `Bearer ${creds.token}` };
  const config = await (await request.get("/api/links/config", { headers: auth })).json();
  expect(config.enabled, "the stack must run with LINKS_ENABLED=true").toBe(true);
  await page.goto("/practice");

  // 1. 练习页「今日任务」卡:还没选书 → 没有「背单词」行;「跟读一句」未完成
  await expect(page.getByTestId("daily-tasks-card")).toBeVisible();
  await expect(page.getByTestId("daily-task-practice.shadow")).toHaveAttribute("data-state", "todo");
  await expect(page.getByTestId("daily-task-wordbook.today")).toHaveCount(0);

  // 2. 选书「初中」→「背单词」行出现、未完成
  expect((await request.put("/api/wordbook/enrollment", { headers: auth, data: { book_id: "junior", order_mode: "book" } })).status()).toBe(200);
  await page.reload();
  await expect(page.getByTestId("daily-task-wordbook.today")).toHaveAttribute("data-state", "todo");

  // 3. 学新词一轮:每张遮罩词卡点「模糊」(都进本轮小测,与抽查比例无关);小测第一题故意选错
  const batchResponse = page.waitForResponse((r) => r.url().endsWith("/api/wordbook/learn/batch") && r.request().method() === "POST");
  await page.goto("/wordbook/learn");
  const batch = (await (await batchResponse).json()) as Batch;
  const card = page.getByTestId("word-card");
  for (let i = 0; i < batch.cards.length; i++) {
    await expect(card).toContainText(batch.cards[i].word);
    await page.getByRole("button", { name: "模糊", exact: true }).click();
    await page.getByRole("button", { name: i < batch.cards.length - 1 ? "下一个" : "开始小测" }).click();
  }
  const question = page.getByTestId("choice-question");
  const summary = page.getByTestId("session-summary");
  let missed = "";
  for (let guard = 0; guard < 15; guard++) {
    await expect(question.or(summary)).toBeVisible();
    if (await summary.isVisible()) break;
    const { word, answer } = await currentQuestion(page, batch);
    if (!missed) {
      missed = word;
      await question.locator("li button").filter({ hasNotText: answer }).first().click();
      await expect(question.locator('button[data-state="wrong"]')).toBeVisible();
    } else {
      await question.getByRole("button", { name: answer, exact: true }).click();
    }
    await expect(question.locator('button[data-state="correct"]')).toBeVisible();
    await page.getByRole("button", { name: "继续" }).click();
  }
  await expect(summary).toBeVisible();
  const missedKey = batch.cards.find((c) => c.word === missed)!.key;

  // 4. 「我的 → 词汇本」:出现「易错词 · 1」,进入能看到该词
  await page.goto("/me");
  await page.getByTestId("me-vocabulary").click();
  const entry = page.getByTestId("notebook-mistakes");
  await expect(entry).toContainText("易错词");
  await expect(entry).toContainText("1");
  await entry.click();
  await expect(page).toHaveURL(/\/links\/mistakes$/);
  await expect(page.getByTestId(`mistake-${missedKey}`)).toBeVisible();

  // 5. 词行的「加入词汇本」旁有「更多」:面板四行(加入词汇本 / 加入词书学习 / 跟读这个词 / 查看词卡)
  await page.getByTestId(`mistake-${missedKey}-vocab-more`).click();
  const sheet = page.getByTestId(`mistake-${missedKey}-vocab-sheet`);
  await expect(sheet).toBeVisible();
  await expect(sheet).toContainText(/加入词汇本|已在词汇本中/);
  for (const row of ["加入词书学习", "跟读这个词", "查看词卡"]) await expect(sheet).toContainText(row);
  await page.keyboard.press("Escape");
  await expect(sheet).toBeHidden();

  // 6. 「我的 → 学习联动」关掉「易错词」→ 生词本入口消失、接口 404;打开回来入口恢复
  await page.goto("/me");
  await page.getByTestId("me-links").click();
  await expect(page).toHaveURL(/\/me\/links$/);
  const toggle = page.getByTestId("link-switch-mistakes");
  await expect(toggle).toHaveAttribute("aria-checked", "true");
  await toggle.click();
  await expect(toggle).toHaveAttribute("aria-checked", "false");
  expect((await request.get("/api/links/mistakes", { headers: auth })).status()).toBe(404);
  await page.goto("/vocabulary");
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  await expect(page.getByTestId("notebook-mistakes")).toHaveCount(0);
  await page.goto("/me/links");
  await page.getByTestId("link-switch-mistakes").click();
  await expect(page.getByTestId("link-switch-mistakes")).toHaveAttribute("aria-checked", "true");
  await page.goto("/vocabulary");
  await expect(page.getByTestId("notebook-mistakes")).toBeVisible();

  expect(upstreams.unmocked).toEqual([]);
});
