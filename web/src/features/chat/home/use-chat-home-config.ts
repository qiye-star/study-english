import { useEffect, useState } from "react";
import type { ApiClient } from "~/api/client";
import { useAuth } from "~/auth/auth-context";

export type ChatHomeStatus = "loading" | "on" | "off";

/** 加载中超过这么久仍无结果就按「关」渲染旧页面(FR2);下次挂载再试。 */
export const CONFIG_WAIT_MS = 3000;

const cache = new WeakMap<ApiClient, Promise<boolean>>();

/** `CHAT_HOME_ENABLED` 是否开启。每个 ApiClient 只缓存成功的结果;失败 / 404 这次视为关闭并删缓存,下次再试(同 use-rooms-enabled)。 */
export function loadChatHomeEnabled(api: ApiClient): Promise<boolean> {
  let pending = cache.get(api);
  if (!pending) {
    // 直接用 api.request(与 getChatHomeConfig 同一请求):不把整个 chat-home-api 模块拉进主包
    pending = api.request<{ enabled: boolean }>("GET", "/api/chat-home/config").then((c) => c.enabled === true, () => {
      cache.delete(api);
      return false;
    });
    cache.set(api, pending);
  }
  return pending;
}

/** 登出清理:丢掉开关缓存(下一个 ApiClient 本来就是新的,这里只是保险)。 */
export function resetChatHomeConfig(api?: ApiClient): void {
  if (api) cache.delete(api);
}

export function useChatHomeConfig(): { status: ChatHomeStatus } {
  const { api } = useAuth();
  const [status, setStatus] = useState<ChatHomeStatus>("loading");
  useEffect(() => {
    let alive = true;
    let timedOut = false;
    setStatus("loading");
    const timer = window.setTimeout(() => { timedOut = true; if (alive) setStatus("off"); }, CONFIG_WAIT_MS);
    void loadChatHomeEnabled(api).then((on) => {
      if (!alive || timedOut) return; // 超时后这次挂载保持旧页面,不在用户面前换界面
      window.clearTimeout(timer);
      setStatus(on ? "on" : "off");
    });
    return () => { alive = false; window.clearTimeout(timer); };
  }, [api]);
  return { status };
}
