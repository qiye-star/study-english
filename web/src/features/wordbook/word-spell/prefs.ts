import { WORDBOOK_PREFS_KEY, readJson, writeJson } from "~/lib/storage";

/**
 * 单词拼写的本机偏好(plan 2026-10-27 R-W5 / R-W7)。与 `spell/prefs.ts` 共用同一个键,写入时合并、不覆盖别的字段;
 * 退出登录时 `auth/device-data.clearDeviceData()` 整键清除。
 */
export type WordSpellMode = "dictation" | "meaning";

export interface WordSpellPrefs {
  wordSpellMode: WordSpellMode;
  /** 「想不起来?点输入框的边框看单词」只显示一次 */
  wordSpellPeekHintSeen: boolean;
}

const DEFAULTS: WordSpellPrefs = { wordSpellMode: "dictation", wordSpellPeekHintSeen: false };

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

export function readPrefs(): WordSpellPrefs {
  const stored = readJson(WORDBOOK_PREFS_KEY, isRecord);
  const mode = stored?.wordSpellMode;
  return {
    wordSpellMode: mode === "dictation" || mode === "meaning" ? mode : DEFAULTS.wordSpellMode,
    wordSpellPeekHintSeen: stored?.wordSpellPeekHintSeen === true,
  };
}

export function writePrefs(patch: Partial<WordSpellPrefs>): void {
  const stored = readJson(WORDBOOK_PREFS_KEY, isRecord) ?? {};
  writeJson(WORDBOOK_PREFS_KEY, { ...stored, ...patch });
}
