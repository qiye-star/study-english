import { WORDBOOK_PREFS_KEY, readJson, writeJson } from "~/lib/storage";

/**
 * 「双击选项可查词」一次性提示的本机记忆(计划 2026-10-13-review-after-answer R-A12):布尔 `doubleTapHintSeen`,
 * 与拼写偏好、短语偏好共用 `WORDBOOK_PREFS_KEY` 的 JSON(合并写入,不覆盖别的字段;退出登录由 clearDeviceData 清除)。
 * 不含任何词。存储不可用时读到 false、写入静默丢弃。
 */
const isObject = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

export function readDoubleTapHintSeen(): boolean {
  return readJson(WORDBOOK_PREFS_KEY, isObject)?.doubleTapHintSeen === true;
}

export function writeDoubleTapHintSeen(): void {
  const stored = readJson(WORDBOOK_PREFS_KEY, isObject) ?? {};
  writeJson(WORDBOOK_PREFS_KEY, { ...stored, doubleTapHintSeen: true });
}
