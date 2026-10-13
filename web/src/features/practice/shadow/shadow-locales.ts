import i18n from "~/i18n";
import en from "./locales/en.json";
import zh from "./locales/zh-CN.json";

/**
 * 跟读弹窗的界面文案不进主包(R-S09):`**\/i18n/*.json` 由 i18n/index.ts 急切合并,这里的 locales/ 不在那个 glob 里。
 * 懒块里每个用到 web.practice.shadow.* 的模块都 `import "./shadow-locales"`,求值时并入 i18next(深合并,不覆盖已有键)。
 */
let loaded = false;
export function ensureShadowI18n(): void {
  if (loaded) return;
  loaded = true;
  i18n.addResourceBundle("en", "translation", en, true, false);
  i18n.addResourceBundle("zh-CN", "translation", zh, true, false);
}

ensureShadowI18n();
