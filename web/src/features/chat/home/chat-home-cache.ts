import { removeKey } from "~/lib/storage";

// 登出清理入口。留在主包里,所以这个文件刻意很小:store / 设置缓存等重模块在自己被加载时登记清理函数
// (`onChatHomeReset`),没加载过的模块没有东西可清(主包预算,计划 K5)。

/** 本机标记(只存日期 / 布尔,绝不存问候正文或 /today 响应)。 */
export const CHAT_HOME_SHOWN_KEY = "enjoy.chatHome.shown"; // "YYYY-MM-DD":今天已在本机弹过(daily 防重)
export const CHAT_HOME_ROLE_HINT_KEY = "enjoy.chatHome.roleHintSeen"; // "1":新对话的角色提示已读

const resets = new Set<() => void>();

/** 登记一个登出时要调用的清理函数(模块求值时调用)。 */
export function onChatHomeReset(fn: () => void): void {
  resets.add(fn);
}

/** 登出清理(auth/device-data):内存里的今天结果、在途请求、设置缓存,以及两个本机标记。任何失败都不抛出。 */
export function clearChatHomeCache(): void {
  for (const fn of resets) {
    try {
      fn();
    } catch {
      /* ignore */
    }
  }
  try {
    removeKey(CHAT_HOME_SHOWN_KEY);
    removeKey(CHAT_HOME_ROLE_HINT_KEY);
  } catch {
    /* ignore */
  }
}
