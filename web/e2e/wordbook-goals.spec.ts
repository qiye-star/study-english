import { expect, test, type Page } from "@playwright/test";
import { signIn } from "./support/auth";
import { mockUpstreams } from "./support/mock-upstreams";

// 每日目标面板(计划 2026-10-11-wordbook-goals GW6):E2E 栈 WORDBOOK_ENABLED=true;零上游。
test.use({ locale: "zh-CN" });

/**
 * 学 1 个新词(计划 B-6):遮罩词卡点「模糊」(与 WORDBOOK_SPOT_CHECK_PCT=100 无关,INDEX §8)→「开始小测」→
 * 选释义(答错时记下正确项,词回到队尾再出现时选它)→ 小结「回到首页」。不改 wordbook.spec.ts。
 */
async function learnOneWord(page: Page) {
  await page.getByTestId("wordbook-action-learn").click();
  await expect(page.getByTestId("recall-cover")).toBeVisible();
  await page.getByRole("button", { name: "模糊", exact: true }).click();
  await page.getByRole("button", { name: "开始小测" }).click();
  const correct = new Map<string, string>();
  const summary = page.getByTestId("session-summary");
  const question = page.getByTestId("choice-question");
  for (let guard = 0; guard < 10; guard++) {
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
  await page.getByRole("button", { name: "回到首页" }).click();
  await expect(page).toHaveURL(/\/wordbook$/);
}

test("wordbook goals: change the goal in place, extra words, pause, resume, reset", async ({ page, request }) => {
  const upstreams = await mockUpstreams(page);
  await signIn(page, request);
  await page.goto("/wordbook/books");
  await page.getByTestId("wordbook-book-junior").click();
  await page.getByRole("button", { name: "开始" }).click();
  await expect(page).toHaveURL(/\/wordbook$/);

  // 齿轮 → 每日新词 30:不离开首页,学新词计数立刻变成 30
  await page.getByRole("button", { name: "每日目标设置" }).click();
  const sheet = page.getByRole("dialog", { name: "每日目标" });
  await sheet.getByRole("radiogroup", { name: "每日新词" }).getByRole("radio", { name: "30" }).click();
  await expect(sheet.getByTestId("goals-today")).toContainText("新词 0 / 30");
  await page.keyboard.press("Escape");
  await expect(sheet).toBeHidden();
  await expect(page.getByRole("button", { name: "每日目标设置" })).toBeFocused();
  await expect(page.getByTestId("wordbook-action-learn")).toContainText("30");

  // 自定义 1 个(数字键盘输入框)→ 学满 → 达标横幅 → 加练 5
  await page.getByRole("button", { name: "调整今天的目标" }).click();
  await sheet.getByRole("radiogroup", { name: "每日新词" }).getByRole("radio", { name: "自定义" }).click();
  const daily = sheet.getByRole("textbox", { name: "每日新词" });
  await expect(daily).toHaveAttribute("inputmode", "numeric");
  await daily.fill("1");
  await daily.press("Enter");
  await expect(sheet.getByTestId("goals-today")).toContainText("新词 0 / 1");
  await page.keyboard.press("Escape");
  await learnOneWord(page);
  await expect(page.getByTestId("wordbook-streak")).toContainText("1 天");
  await page.getByRole("button", { name: "今天加练" }).click();
  await sheet.getByRole("radiogroup", { name: "加练数量" }).getByRole("radio", { name: "5", exact: true }).click();
  await sheet.getByRole("button", { name: "加练 5 个" }).click();
  await expect(page).toHaveURL(/\/wordbook\/learn$/);

  // 暂停 → 暂停卡 → 继续
  await page.goto("/wordbook");
  await page.getByRole("button", { name: "每日目标设置" }).click();
  await sheet.getByRole("button", { name: "暂停这本书" }).click();
  await page.getByRole("alertdialog").getByRole("button", { name: "暂停" }).click();
  await expect(page.getByTestId("wordbook-paused")).toContainText("已暂停");
  await page.getByRole("button", { name: "继续学习" }).click();
  await expect(page.getByRole("button", { name: "每日目标设置" })).toBeVisible();

  // 重置:输入书名前按钮不可点;重置后已学归零(初中只用本书新建的词)
  await page.getByRole("button", { name: "每日目标设置" }).click();
  await sheet.getByRole("button", { name: "重置进度" }).click();
  const alert = page.getByRole("alertdialog");
  await expect(alert.getByRole("button", { name: "重置进度" })).toBeDisabled();
  await alert.getByRole("textbox").fill("初中");
  await alert.getByRole("button", { name: "重置进度" }).click();
  await expect(page.getByTestId("wordbook-legend")).toContainText("已学0");
  expect(upstreams.unmocked).toEqual([]);
});
