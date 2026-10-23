import i18n from "~/i18n";
import en from "./locales/en.json";
import zh from "./locales/zh-CN.json";

/**
 * 对话主页的文案(`web.chat.home.*`)不进主包(计划 2026-10-23-chat-home-daily-greeting-web 主包预算,同 agents R-W3):
 * `locales/` 不在 i18n/index.ts 的 `**\/i18n/*.json` 急切合并范围里。每个懒加载入口(弹窗、抽屉、设置面板、外框)
 * 都 `import "./locales"`,模块求值时并入 i18next(深合并,不覆盖已有键)。
 */
let loaded = false;
export function ensureChatHomeI18n(): void {
  if (loaded) return;
  loaded = true;
  i18n.addResourceBundle("en", "translation", en, true, false);
  i18n.addResourceBundle("zh-CN", "translation", zh, true, false);
}

ensureChatHomeI18n();
