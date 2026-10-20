import i18n from "~/i18n";
import en from "./locales/en.json";
import zh from "./locales/zh-CN.json";

/**
 * 人机验证的文案不进主包(INDEX X37 的做法):`**\/i18n/*.json` 由 i18n/index.ts 急切合并,这里的 locales/ 不在那个 glob 里。
 * 组件分块与外壳都 `import "./locales"`,模块求值时并入 i18next(深合并,不覆盖已有键)。
 */
let loaded = false;
export function ensureCaptchaI18n(): void {
  if (loaded) return;
  loaded = true;
  i18n.addResourceBundle("en", "translation", en, true, false);
  i18n.addResourceBundle("zh-CN", "translation", zh, true, false);
}

ensureCaptchaI18n();
