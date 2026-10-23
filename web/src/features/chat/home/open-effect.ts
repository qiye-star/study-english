import type { ApiClient } from "~/api/client";
import { startOpenDetection } from "./chat-home-open";
import { loadChatHomeEnabled } from "./use-chat-home-config";

/** 动态块入口(register-chat-home 挂载时加载):开关为开才开始检测「打开」;返回停止函数(开关关 = 空操作)。 */
export async function startChatHomeOpen(api: ApiClient): Promise<() => void> {
  if (!(await loadChatHomeEnabled(api))) return () => undefined;
  return startOpenDetection(api);
}
