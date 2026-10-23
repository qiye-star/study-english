import { removeKey } from "~/lib/storage";
import { resetChatHomeStore } from "./chat-home-store";

/** 本机标记(只存日期 / 布尔,绝不存问候正文或 /today 响应)。 */
export const CHAT_HOME_SHOWN_KEY = "enjoy.chatHome.shown"; // "YYYY-MM-DD":今天已在本机弹过(daily 防重)
export const CHAT_HOME_ROLE_HINT_KEY = "enjoy.chatHome.roleHintSeen"; // "1":新对话的角色提示已读

/** 登出清理(auth/device-data):内存里的今天结果、在途请求,以及两个本机标记。任何失败都不抛出。 */
export function clearChatHomeCache(): void {
  try {
    resetChatHomeStore();
  } catch {
    /* ignore */
  }
  try {
    removeKey(CHAT_HOME_SHOWN_KEY);
    removeKey(CHAT_HOME_ROLE_HINT_KEY);
  } catch {
    /* ignore */
  }
}
