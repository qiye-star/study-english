import { WORDBOOK_PREFS_KEY, readJson, removeKey, writeJson } from "~/lib/storage";

/**
 * 按句拼写的本机偏好(spec §11.5「显示字母数」)。键 `enjoy-web.wordbook.prefs` 只在 `lib/storage.ts` 定义一次
 * (web-core);退出登录由 `auth/device-data.clearDeviceData()` 按同一个键清除。
 */
export { WORDBOOK_PREFS_KEY };

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
