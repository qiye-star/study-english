import i18n from "~/i18n";
import en from "./locales/en.json";
import zh from "./locales/zh-CN.json";

/**
 * 配音的界面文案不进主包(计划 L5 R20:只有 en 与 zh-CN,没有西语)。懒加载块里用到 web.dubbing.* 的模块才调用它,深合并不覆盖已有键。
 */
let loaded = false;
export function ensureDubbingI18n(): void {
  if (loaded) return;
  loaded = true;
  i18n.addResourceBundle("en", "translation", en, true, false);
  i18n.addResourceBundle("zh-CN", "translation", zh, true, false);
}

// 求值时即合并(同 library/locales.ts):每个用到 web.dubbing.* 的模块都 `import "./locales"`。
ensureDubbingI18n();
