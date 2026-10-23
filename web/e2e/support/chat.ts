import { expect, type Page } from "@playwright/test";

/**
 * 对话入口的「模式无关」帮助函数(chat home 计划 W12):`CHAT_HOME_ENABLED` 关 = 旧会话列表(`conversation-new`),
 * 开 = `/chat` 是今天的对话、历史在左侧抽屉、新对话在 `/chat/new`。同一个用例两种开关状态都能走通。
 * 开关开时,首次进入 `/chat` 可能弹问候:这里的帮助函数会先把它跳过。
 */

/** 现在是不是新对话主页(等到旧列表或新顶栏任意一个出现再判断)。 */
export async function chatHomeOn(page: Page): Promise<boolean> {
  await page.getByTestId("conversation-new").or(page.getByTestId("chat-history-open")).first().waitFor({ timeout: 15_000 });
  return page.getByTestId("chat-history-open").isVisible();
}

/** 问候弹窗出现就跳过(最多等 `waitMs`);没有弹窗也没关系。 */
export async function dismissGreeting(page: Page, waitMs = 3_000): Promise<void> {
  const modal = page.getByTestId("greeting-modal");
  try {
    await modal.waitFor({ state: "visible", timeout: waitMs });
  } catch {
    return;
  }
  await page.getByTestId("greeting-skip").click();
  await expect(modal).toHaveCount(0);
}

/** 打开历史抽屉(新主页)。 */
export async function openHistory(page: Page): Promise<void> {
  await page.getByTestId("chat-history-open").click();
  await expect(page.getByTestId("chat-history-drawer")).toBeVisible();
}

/** 点底部「对话」标签,进入会话列表(旧)或今天的对话并打开历史抽屉(新)。返回是否新主页。 */
export async function openChatList(page: Page): Promise<boolean> {
  await page.getByTestId("nav-chat").click();
  const on = await chatHomeOn(page);
  if (on) {
    await dismissGreeting(page);
    await openHistory(page);
  }
  return on;
}

/** 打开「新对话」的场景面板(`scenario-*` 都在里面),旧新两种模式。 */
export async function openScenarioSheet(page: Page): Promise<void> {
  await page.getByTestId("nav-chat").click();
  if (await chatHomeOn(page)) {
    await dismissGreeting(page);
    await openHistory(page);
    await page.getByTestId("chat-history-new").click();
    await page.getByTestId("chat-new-scenario").click();
  } else {
    await page.getByTestId("conversation-new").click();
  }
}

/** 新建一个对话并进入它(`/chat/<uuid>`),返回对话 id。`scenario` 缺省 = 自由对话(新主页下走「直接开始」)。 */
export async function startChat(page: Page, scenario = "free"): Promise<string> {
  await page.getByTestId("nav-chat").click();
  if (!(await chatHomeOn(page))) {
    await page.getByTestId("conversation-new").click();
    await page.getByTestId(`scenario-${scenario}`).click();
  } else {
    await dismissGreeting(page);
    await openHistory(page);
    await page.getByTestId("chat-history-new").click();
    if (scenario === "free") {
      await page.getByTestId("chat-new-just-start").click();
    } else {
      await page.getByTestId("chat-new-scenario").click();
      await page.getByTestId(`scenario-${scenario}`).click();
    }
  }
  await expect(page).toHaveURL(/\/chat\/[0-9a-f-]{36}$/);
  return page.url().split("/").pop()!;
}

/** 列表(旧)或抽屉(新)里的对话行数。今天的默认对话固定在抽屉顶部,不在 `conversation-item` 里。 */
export async function expectChatCount(page: Page, count: number): Promise<void> {
  await expect(page.getByTestId("conversation-item")).toHaveCount(count);
}

/** 删除列表 / 抽屉里的第一个对话(两种模式 testid 相同)。 */
export async function deleteFirstChat(page: Page): Promise<void> {
  await page.getByTestId("conversation-delete").first().click();
  await page.getByTestId("conversation-delete-confirm").click();
}

/** 没有(自己建的)对话了:旧 = 空列表提示;新 = 抽屉里的空提示。 */
export async function expectNoChats(page: Page): Promise<void> {
  await expect(page.getByTestId("conversations-empty").or(page.getByTestId("chat-history-empty"))).toBeVisible();
}
