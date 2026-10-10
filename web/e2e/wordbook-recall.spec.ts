import { createHash } from "node:crypto";
import { expect, test, type Page } from "@playwright/test";
import { signIn } from "./support/auth";
import { mockUpstreams } from "./support/mock-upstreams";
import * as db from "./support/wordbook-db";

// 背单词 v2(计划 2026-10-11-wordbook-recall Z1):遮罩词卡 → 认识 / 模糊 / 不认识 → 本轮小测 → 小结 → 复习「快速回忆」。
// 栈:WORDBOOK_ENABLED=true、WORDBOOK_SPOT_CHECK_PCT=100(每个「认识」都抽查,断言才确定;docker-compose.e2e.yml)。
// 整场零上游:只走 /api/wordbook/* 的数据库路径,朗读被模拟。复习那一段要把词改到期,需要 support/wordbook-db.ts 的环境变量。
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

/** 与服务端 quiz.use_recall 相同(盒 1、2、4、5,40%)。 */
function useRecall(uid: number, key: string, reps: number, box: number): boolean {
  if (![1, 2, 4, 5].includes(box)) return false;
  return createHash("sha256").update(`recall:${uid}:${key}:${reps}`).digest().readUInt32BE(0) % 100 < 40;
}

/** 本轮小测:按题面找出正确项(选释义 → 释义行;看释义选词 → 词头)并点它。 */
async function answerCorrectly(page: Page, batch: Batch) {
  const question = page.getByTestId("choice-question");
  const word = question.getByTestId("question-word");
  let answer: string;
  if (await word.count()) {
    const text = ((await word.textContent()) ?? "").trim();
    answer = meaningLine(batch.cards.find((c) => c.word === text)!);
  } else {
    const meaning = ((await question.getByTestId("question-meaning").textContent()) ?? "").trim();
    const drill = batch.drill.find((q) => q.prompt.meaning === meaning)!;
    answer = batch.cards.find((c) => c.key === drill.key)!.word;
  }
  await question.getByRole("button", { name: answer, exact: true }).click();
  await expect(question.locator('button[data-state="correct"]')).toBeVisible();
}

test("wordbook v2: covered card, three ratings, round quiz, quick recall", async ({ page, request }) => {
  const upstreams = await mockUpstreams(page);
  const creds = await signIn(page, request);
  const auth = { Authorization: `Bearer ${creds.token}` };
  expect((await request.put("/api/wordbook/enrollment", { headers: auth, data: { book_id: "junior", order_mode: "book" } })).status()).toBe(200);

  // 1. 学新词:记下这一批(词卡 + 小测题),用来判断遮罩时释义不在页面上、以及小测的正确项
  const batchResponse = page.waitForResponse((r) => r.url().endsWith("/api/wordbook/learn/batch") && r.request().method() === "POST");
  await page.goto("/wordbook/learn");
  const batch = (await (await batchResponse).json()) as Batch;
  expect(batch.cards).toHaveLength(5);
  const card = page.getByTestId("word-card");
  const badge = page.getByTestId("rating-badge");
  const cover = page.getByTestId("recall-cover");
  const meaningOf = (i: number) => batch.cards[i].senses[0].text;

  // 第 1 张:遮罩时释义不在 DOM;「模糊」→ 释义出现、徽标「模糊」
  await expect(card).toContainText(batch.cards[0].word);
  await expect(cover).toHaveAttribute("aria-expanded", "false");
  await expect(card).not.toContainText(meaningOf(0));
  await page.getByRole("button", { name: "模糊", exact: true }).click();
  await expect(badge).toHaveText("模糊");
  await expect(card).toContainText(meaningOf(0));
  await page.getByRole("button", { name: "下一个" }).click();

  // 第 2 张:先点遮罩偷看 → 提示 → 「认识」按「模糊」记
  await expect(card).toContainText(batch.cards[1].word);
  await expect(card).not.toContainText(meaningOf(1));
  await cover.click();
  await expect(card).toContainText(meaningOf(1));
  await expect(page.getByText("已看过释义:点「认识」会记为「模糊」")).toBeVisible();
  await page.getByRole("button", { name: "认识", exact: true }).click();
  await expect(badge).toHaveText("模糊");
  await page.getByRole("button", { name: "下一个" }).click();

  // 第 3 张:不认识;第 4、5 张:认识(抽查 100% → 「认识 · 本轮抽查」)
  await expect(card).toContainText(batch.cards[2].word);
  await page.getByRole("button", { name: "不认识", exact: true }).click();
  await expect(badge).toHaveText("不认识");
  await page.getByRole("button", { name: "下一个" }).click();
  for (const i of [3, 4]) {
    await expect(card).toContainText(batch.cards[i].word);
    await page.getByRole("button", { name: "认识", exact: true }).click();
    await expect(badge).toHaveText("认识 · 本轮抽查");
    await page.getByRole("button", { name: i < 4 ? "下一个" : "开始小测" }).click();
  }

  // 2. 本轮小测:模糊 2 + 不认识 2(选释义 + 看释义选词)+ 抽查 2 = 6 题,全部一次答对
  const summary = page.getByTestId("session-summary");
  await expect(page.getByText("1 / 6")).toBeVisible();
  for (let n = 0; n < 6; n++) {
    await answerCorrectly(page, batch);
    await page.getByRole("button", { name: "继续" }).click();
  }
  await expect(summary).toContainText("学会 5 个新词");
  await expect(page.getByTestId("summary-ratings")).toContainText("认识 2 · 模糊 2 · 不认识 1");
  await expect(page.getByTestId("summary-ratings")).toContainText("抽查 2 · 通过 2");

  // 3. 复习「快速回忆」:把一个会出快速回忆的盒 1 / 2 的词改到期(需要数据库夹具)
  const offset = await page.evaluate(() => -new Date().getTimezoneOffset());
  const today = async () => (await (await request.get(`/api/wordbook/today?tz_offset_minutes=${offset}`, { headers: auth })).json()).plan;
  if (!db.available()) {
    test.info().annotations.push({ type: "skipped-part", description: "review: set E2E_SQLITE_PATH or E2E_COMPOSE_PROJECT" });
    expect((await today()).new_done).toBe(5);
    expect(upstreams.unmocked).toEqual([]);
    return;
  }
  const first = await db.rowsOf(creds.username);
  expect(first.rows.map((r) => r.box).sort()).toEqual([0, 1, 1, 2, 2]); // 不认识 0 · 模糊(含偷看)1 · 抽查通过 2
  const { uid } = first;
  let rows = first.rows;
  let learned = 5;
  // 四个盒 1 / 2 的词都不出快速回忆的概率约 13%:再用接口按「模糊」学几批,直到有一个会出(最多 3 批)
  for (let extra = 0; extra < 3 && !rows.some((r) => r.box > 0 && useRecall(uid, r.word, r.reps, r.box)); extra++) {
    const more = (await (await request.post("/api/wordbook/learn/batch", { headers: auth, data: { size: 5, tz_offset_minutes: offset } })).json()) as Batch;
    for (const c of more.cards) {
      const r = await request.post("/api/wordbook/answers", { headers: auth, data: {
        book_id: more.book_id, key: c.key, mode: "learn", qtype: "recall", rating: "fuzzy", tz_offset_minutes: offset } });
      expect(r.status()).toBe(200);
      learned += 1;
    }
    rows = (await db.rowsOf(creds.username)).rows;
  }
  const target = rows.find((r) => r.box > 0 && useRecall(uid, r.word, r.reps, r.box));
  test.skip(!target, "no box 1/2 word draws quick recall for this user id (about 0.3%)");
  await db.makeDue(creds.username, [target!.word]);

  await page.goto("/wordbook/review");
  await page.getByRole("button", { name: /^开始复习/ }).click();
  const recall = page.getByTestId("recall-card");
  await expect(recall).toBeVisible();
  await expect(recall.getByTestId("question-word")).toHaveText(target!.word);
  const targetCard = { key: target!.word, word: target!.word, senses: [] as Sense[] };
  // 正面没有释义;「认识」→ 抽查题(pct = 100)→ 选对 → 翻面、徽标「认识」
  await page.getByRole("button", { name: "认识", exact: true }).click();
  await expect(page.getByText("抽查:选出它的意思")).toBeVisible();
  const detail = (await (await request.get(`/api/wordbook/cards/junior/${encodeURIComponent(target!.word)}`, { headers: auth })).json()) as Card;
  targetCard.senses = detail.senses;
  await page.getByTestId("choice-question").getByRole("button", { name: meaningLine(targetCard), exact: true }).click();
  await expect(page.getByTestId("recall-back")).toBeVisible();
  await expect(badge).toHaveText("认识");
  // 「记错了」→ 徽标「不认识」(未到期的不认识 = apply_lapse)
  await page.getByRole("button", { name: "记错了" }).click();
  await expect(badge).toHaveText("不认识");
  await page.getByRole("button", { name: "继续" }).click();
  // 记错了的词回到队尾再出现一次:「不认识」→ 继续 → 小结
  for (let guard = 0; guard < 4 && !(await summary.isVisible()); guard++) {
    await expect(recall.or(summary)).toBeVisible();
    if (await summary.isVisible()) break;
    await page.getByRole("button", { name: "不认识", exact: true }).click();
    await page.getByRole("button", { name: "继续" }).click();
  }
  await expect(summary).toBeVisible();

  const plan = await today();
  expect([plan.new_done, plan.review_done]).toEqual([learned, 1]);
  const after = await db.rowsOf(creds.username);
  expect(after.rows.find((r) => r.word === target!.word)).toMatchObject({ box: 0, reps: target!.reps + 1 });
  expect(upstreams.unmocked).toEqual([]);
});
