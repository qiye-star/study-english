import { readJson, removeKey, writeJson } from "~/lib/storage";

/**
 * 按句拼写的本机偏好(spec §11.5「显示字母数」)。
 * Ruling WS2-1:键名按 spec 是 `enjoy-web.wordbook.prefs`;`lib/storage.ts` 与 `auth/device-data.ts` 归 WC 车道,
 * 所以键与清除函数先放这里,WC 合并后由 `device-data.clearDeviceData()` 调用 `clearSpellPrefs()`(登出清除)。
 */
export const WORDBOOK_PREFS_KEY = "enjoy-web.wordbook.prefs";

export interface SpellPrefs { showLength: boolean }

const DEFAULTS: SpellPrefs = { showLength: false };

const isPrefs = (v: unknown): v is Partial<SpellPrefs> => typeof v === "object" && v !== null && !Array.isArray(v);

export function readPrefs(): SpellPrefs {
  const stored = readJson(WORDBOOK_PREFS_KEY, isPrefs);
  return { showLength: typeof stored?.showLength === "boolean" ? stored.showLength : DEFAULTS.showLength };
}

export function writePrefs(prefs: SpellPrefs): void {
  const stored = readJson(WORDBOOK_PREFS_KEY, isPrefs) ?? {};
  writeJson(WORDBOOK_PREFS_KEY, { ...stored, ...prefs }); // 保留同一键下其他车道将来写入的字段
}

export function clearSpellPrefs(): void {
  removeKey(WORDBOOK_PREFS_KEY);
}
