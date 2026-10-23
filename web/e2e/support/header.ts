import type { Locator, Page } from "@playwright/test";

/**
 * (新对话主页里这些行在右上角的设置面板里;用完调 `closeHeaderOptions` 关掉那个模态面板,旧外框里它什么都不做。)
 * 对话页顶栏的双语、自动朗读、语速、复盘、对话设置收在"选项"弹出面板里(redesign v3)。
 * 面板没开就先点开顶栏的调整按钮,返回该控件。开关类点了不关面板,复盘/设置点了会关。
 */
export async function headerOption(page: Page, testId: string): Promise<Locator> {
  const target = page.getByTestId(testId);
  if (!(await target.isVisible())) {
    const classic = page.getByTestId("conversation-options");
    await ((await classic.count()) > 0 ? classic : page.getByTestId("chat-settings-open")).click();
  }
  return target;
}

/** 新对话主页的设置面板是模态的:读写完选项后关掉它,后面才能点页面。旧外框的弹出面板不挡操作,无需关闭。 */
export async function closeHeaderOptions(page: Page): Promise<void> {
  const done = page.getByTestId("chat-settings-done");
  if (await done.isVisible()) await done.click();
}
