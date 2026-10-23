/** localStorage 的安全读写:隐私模式、配额满、禁用存储时都不抛错。 */
export function readJson<T>(key: string, guard: (value: unknown) => value is T): T | null {
  try {
    const raw = window.localStorage.getItem(key);
    if (raw === null) return null;
    const parsed: unknown = JSON.parse(raw);
    return guard(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

export function writeJson(key: string, value: unknown): boolean {
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
    return true;
  } catch {
    return false;
  }
}

export function removeKey(key: string): void {
  try {
    window.localStorage.removeItem(key);
  } catch {
    /* 存储不可用时无需处理 */
  }
}

/** 练习页草稿(参考文本)的存储键;登出时由 auth/device-data 清除。 */
export const PRACTICE_DRAFT_KEY = "enjoy-web.practice.reference";

/** 背单词的本机偏好(如拼写「显示字母数」,spec §11.5);登出时由 auth/device-data 清除。 */
export const WORDBOOK_PREFS_KEY = "enjoy-web.wordbook.prefs";

/** 更新日志的本机偏好(一次性小提示是否已显示,计划 2026-10-14-changelog R-15);登出时由 auth/device-data 清除。 */
export const CHANGELOG_PREFS_KEY = "enjoy-web.changelog.prefs";

/** 液态玻璃「主题自定义」的本机偏好(计划 2026-10-15-liquid-glass INDEX §4.4);登出时由 auth/device-data 清除。 */
export const GLASS_THEME_KEY = "enjoy-web.appearance.glass";

/** 朗读音色的本机偏好(按场景:单词 / 句子 / 对话消息,「我的 → 朗读音色」);登出时由 auth/device-data 清除。 */
export const TTS_VOICE_PREF_KEY = "enjoy-web.tts.voice";

/** 中文释义显示偏好(「我的 → 中文释义」,只在 "tap" 时存);登出时由 auth/device-data 清除。 */
export const ZH_DEFS_PREF_KEY = "enjoy-web.defs.zh";
