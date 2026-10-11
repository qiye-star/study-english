import { registerAgentsLocales } from "../locales";
import en from "./locales/en.json";
import zh from "./locales/zh-CN.json";

/** 带学文案(`web.agents.tutor.*`)随懒加载块并入 i18next(INDEX X11);不在主包的 `**\/i18n/*.json` glob 里。 */
registerAgentsLocales({ en, "zh-CN": zh });
