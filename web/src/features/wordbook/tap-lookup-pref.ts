import { WORDBOOK_PREFS_KEY, readJson, writeJson } from "~/lib/storage";

/**
 * 「点一下单词会出现横线,再点一次查词」一次性提示的本机记忆(替换长按提示):布尔 `tapLookupHintSeen`,
 * 与拼写偏好、短语偏好共用 `WORDBOOK_PREFS_KEY` 的 JSON(合并写入,不覆盖别的字段;退出登录由 clearDeviceData 整键清除)。
 * 旧字段 `longPressHintSeen` / `doubleTapHintSeen` 不读不删(无害,退出登录随整键清除)。不含任何词。存储不可用时读到 false、写入静默丢弃。
 */
const isObject = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

export function readTapLookupHintSeen(): boolean {
  return readJson(WORDBOOK_PREFS_KEY, isObject)?.tapLookupHintSeen === true;
}

export function writeTapLookupHintSeen(): void {
  const stored = readJson(WORDBOOK_PREFS_KEY, isObject) ?? {};
  writeJson(WORDBOOK_PREFS_KEY, { ...stored, tapLookupHintSeen: true });
}
