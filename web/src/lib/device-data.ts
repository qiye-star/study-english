import { sharedTtsCache } from "~/features/chat/tts";
import { kvClear } from "./kv-cache";
import { removeKey } from "./storage";

export const PRACTICE_DRAFT_KEY = "enjoy-web.practice.reference";

/** 退出登录时清掉本机上的每用户数据(练习草稿、查词缓存、朗读音频)。任何失败都不抛出。 */
export function clearDeviceData(): void {
  try {
    removeKey(PRACTICE_DRAFT_KEY);
  } catch {
    /* ignore */
  }
  try {
    sharedTtsCache.clear();
  } catch {
    /* ignore */
  }
  try {
    void kvClear().catch(() => {});
  } catch {
    /* ignore */
  }
}
