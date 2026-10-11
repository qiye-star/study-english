import i18n from "~/i18n";
import en from "./locales/en.json";
import zh from "./locales/zh-CN.json";

/**
 * agents 的文案不进主包(R-W3):`**\/i18n/*.json` 由 i18n/index.ts 急切合并,这里的 locales/ 不在那个 glob 里。
 * 每个懒加载入口模块都 `import "./locales"`,模块求值时并入 i18next(深合并,不覆盖已有键)。
 */
let loaded = false;
export function ensureAgentsI18n(): void {
  if (loaded) return;
  loaded = true;
  i18n.addResourceBundle("en", "translation", en, true, false);
  i18n.addResourceBundle("zh-CN", "translation", zh, true, false);
}

/**
 * 子 feature(memory/、tutor/)的注册入口(INDEX X11):它们把自己的 `locales/{en,zh-CN}.json`(键在 `web.agents.<子域>.*` 之下)
 * 在懒加载块的模块求值时传进来;深合并,不覆盖已有键。同时确保核心文案已并入。
 *   import en from "./locales/en.json"; import zh from "./locales/zh-CN.json";
 *   registerAgentsLocales({ en, "zh-CN": zh });
 */
export function registerAgentsLocales(bundles: { en: object; "zh-CN": object }): void {
  ensureAgentsI18n();
  i18n.addResourceBundle("en", "translation", bundles.en, true, false);
  i18n.addResourceBundle("zh-CN", "translation", bundles["zh-CN"], true, false);
}

ensureAgentsI18n();
