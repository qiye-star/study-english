import i18n from "~/i18n";
import en from "./locales/en.json";
import zh from "./locales/zh-CN.json";

/**
 * 联机「对象」、@ 补全、带练语音、「中文」折叠的文案(plan 2026-10-12-agents-addressing-web R-AW1):不进主包。
 * `**\/i18n/*.json` 由 i18n/index.ts 急切合并,这里的 locales/ 不在那个 glob 里。用到这些键的模块都 `import "./locales"`
 * (它们只在懒加载的房间页块里),模块求值时深合并、不覆盖已有键(locales.test.ts 保证没有重复键)。
 */
let loaded = false;
export function ensureRoomAgentsI18n(): void {
  if (loaded) return;
  loaded = true;
  i18n.addResourceBundle("en", "translation", en, true, false);
  i18n.addResourceBundle("zh-CN", "translation", zh, true, false);
}

ensureRoomAgentsI18n();
