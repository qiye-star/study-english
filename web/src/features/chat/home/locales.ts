import i18n from "~/i18n";
import en from "./locales/en.json";
import zh from "./locales/zh-CN.json";

/**
 * 对话主页的文案不进主包:`**\/i18n/*.json` 由 i18n/index.ts 急切合并,这里的 locales/ 不在那个 glob 里
 * (同 features/agents/locales.ts,主包预算 K5)。每个懒加载入口模块(抽屉、设置面板、…)都 `import "./locales"`,
 * 模块求值时并入 i18next(深合并,不覆盖已有键);键都在 `web.chat.home.*` 之下。
 */
let loaded = false;
export function ensureChatHomeI18n(): void {
  if (loaded) return;
  loaded = true;
  i18n.addResourceBundle("en", "translation", en, true, false);
  i18n.addResourceBundle("zh-CN", "translation", zh, true, false);
}

ensureChatHomeI18n();
