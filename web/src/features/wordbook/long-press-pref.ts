import { WORDBOOK_PREFS_KEY, readJson, writeJson } from "~/lib/storage";

/**
 * 「长按选项里的单词可查询」一次性提示的本机记忆(计划 2026-10-14-review-bilingual-longpress R-L6):布尔 `longPressHintSeen`,
 * 与拼写偏好、短语偏好共用 `WORDBOOK_PREFS_KEY` 的 JSON(合并写入,不覆盖别的字段;退出登录由 clearDeviceData 整键清除)。
 * 旧字段 `doubleTapHintSeen` 不读不删(无害)。不含任何词。存储不可用时读到 false、写入静默丢弃。
 */
const isObject = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

export function readLongPressHintSeen(): boolean {
  return readJson(WORDBOOK_PREFS_KEY, isObject)?.longPressHintSeen === true;
}

export function writeLongPressHintSeen(): void {
  const stored = readJson(WORDBOOK_PREFS_KEY, isObject) ?? {};
  writeJson(WORDBOOK_PREFS_KEY, { ...stored, longPressHintSeen: true });
}
