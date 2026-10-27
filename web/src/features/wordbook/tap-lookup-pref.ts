import { WORDBOOK_PREFS_KEY, readJson, writeJson } from "~/lib/storage";

/**
 * 「点一下单词就能查词」一次性提示的本机记忆:布尔 `tapLookupOnceHintSeen`(一下即查后的新说明,老用户也再看一次),
 * 与拼写偏好、短语偏好共用 `WORDBOOK_PREFS_KEY` 的 JSON(合并写入,不覆盖别的字段;退出登录由 clearDeviceData 整键清除)。
 * 旧字段 `tapLookupHintSeen`(两下旧说明)/ `longPressHintSeen` / `doubleTapHintSeen` 不读不删(无害,退出登录随整键清除)。
 * 不含任何词。存储不可用时读到 false、写入静默丢弃。
 */
const isObject = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

export function readTapLookupHintSeen(): boolean {
  return readJson(WORDBOOK_PREFS_KEY, isObject)?.tapLookupOnceHintSeen === true;
}

export function writeTapLookupHintSeen(): void {
  const stored = readJson(WORDBOOK_PREFS_KEY, isObject) ?? {};
  writeJson(WORDBOOK_PREFS_KEY, { ...stored, tapLookupOnceHintSeen: true });
}
