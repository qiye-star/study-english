import { WORDBOOK_PREFS_KEY, readJson, writeJson } from "~/lib/storage";

/**
 * 短语区的设备级偏好(R-DW10):用户手动收起 / 展开后记在本机,学新词页下次翻开时照它办;没记过(null)= 自动展开。
 * 与拼写偏好共用 `WORDBOOK_PREFS_KEY` 的 JSON(合并写入,不覆盖别的字段;退出登录由 clearDeviceData 清除)。
 * 只存一个布尔值,不含任何词。存储不可用时读到 null、写入静默丢弃。
 */
const isObject = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

export function readPhrasesPref(): boolean | null {
  const stored = readJson(WORDBOOK_PREFS_KEY, isObject);
  return typeof stored?.phrasesOpen === "boolean" ? stored.phrasesOpen : null;
}

export function writePhrasesPref(open: boolean): void {
  const stored = readJson(WORDBOOK_PREFS_KEY, isObject) ?? {};
  writeJson(WORDBOOK_PREFS_KEY, { ...stored, phrasesOpen: open });
}
