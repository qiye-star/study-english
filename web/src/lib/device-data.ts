import { bumpGrammarRev } from "~/features/grammar/grammar-api";
import { sharedTtsCache } from "~/features/chat/tts";
import { kvClear } from "./kv-cache";
import { removeKey } from "./storage";

export const PRACTICE_DRAFT_KEY = "enjoy-web.practice.reference";

/** 退出登录时清掉本机上的每用户数据(练习草稿、递增语法提示词版本、查词/翻译/语法缓存、朗读音频)。任何失败都不抛出。 */
export function clearDeviceData(): void {
  try {
    removeKey(PRACTICE_DRAFT_KEY);
  } catch {
    /* ignore */
  }
  try {
    // 不能清零:kvClear 是异步且可能失败,版本回到 0 会让残留的 grammar:v1:0:* 旧条目重新命中。
    // R15:版本号按设备计;另一设备改了提示词时,本机缓存最多 30 天内可能过期,这是已接受的取舍。
    bumpGrammarRev();
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
