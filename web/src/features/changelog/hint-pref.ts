import { CHANGELOG_PREFS_KEY, readJson, writeJson } from "~/lib/storage";

/**
 * 「第一次出现未读」小提示的本机记忆(计划 R-15):布尔 `hintSeen`,JSON 合并写入;退出登录由 clearDeviceData 清除。
 * 不含任何用户数据。存储不可用时读到 false、写入静默丢弃。
 */
const isObject = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

export function readHintSeen(): boolean {
  return readJson(CHANGELOG_PREFS_KEY, isObject)?.hintSeen === true;
}

export function writeHintSeen(): void {
  const stored = readJson(CHANGELOG_PREFS_KEY, isObject) ?? {};
  writeJson(CHANGELOG_PREFS_KEY, { ...stored, hintSeen: true });
}
