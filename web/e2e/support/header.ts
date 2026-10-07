import type { Locator, Page } from "@playwright/test";

/**
 * 对话页顶栏的双语、自动朗读、语速、复盘、对话设置收在"选项"弹出面板里(redesign v3)。
 * 面板没开就先点开顶栏的调整按钮,返回该控件。开关类点了不关面板,复盘/设置点了会关。
 */
export async function headerOption(page: Page, testId: string): Promise<Locator> {
  const target = page.getByTestId(testId);
  if (!(await target.isVisible())) await page.getByTestId("conversation-options").click();
  return target;
}
