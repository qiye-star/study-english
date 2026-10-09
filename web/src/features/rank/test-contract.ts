import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach } from "vitest";
import i18n from "~/i18n";

/** 测试专用:服务端钉住的段位契约样例(snake_case 原样),只由 *.test.ts(x) 引入。 */
const here = path.dirname(fileURLToPath(import.meta.url));
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const CONTRACT: Record<string, any> = JSON.parse(
  readFileSync(path.resolve(here, "../../../../server/tests/fixtures/rank_contract.json"), "utf8"),
);

/** 本文件里的断言用中文文案:describe 内调用,结束后恢复英文(测试默认语言)。 */
export function inChinese(): void {
  // SettingsProvider 挂载时按保存的设置切语言,所以要写设置而不只是 changeLanguage
  beforeEach(async () => {
    localStorage.setItem("enjoy-web.settings", JSON.stringify({ language: "zh-CN" }));
    await i18n.changeLanguage("zh-CN");
  });
  afterEach(async () => {
    localStorage.removeItem("enjoy-web.settings");
    await i18n.changeLanguage("en");
  });
}
