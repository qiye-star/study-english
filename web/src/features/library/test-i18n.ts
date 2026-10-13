import i18n from "~/i18n";

const KEY = "enjoy-web.settings";

/**
 * 页面测试里切界面语言。`SettingsProvider` 的初始化器按 localStorage 或 `navigator.language`(jsdom 里是 en-US)重设语言,
 * 只调 `i18n.changeLanguage("zh-CN")` 会在 `renderWithProviders` 里被改回 `en`;所以先写 `enjoy-web.settings` 再切语言。
 * 注意:先 `localStorage.clear()` 再调它,不要反过来。
 */
export async function setUiLanguage(language: "en" | "zh-CN"): Promise<void> {
  localStorage.setItem(KEY, JSON.stringify({ language }));
  await i18n.changeLanguage(language);
}

export async function resetUiLanguage(): Promise<void> {
  localStorage.removeItem(KEY);
  await i18n.changeLanguage("en");
}
