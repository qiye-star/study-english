import { useCallback, useEffect, useRef, useState } from "react";
import { useAuth } from "~/auth/auth-context";
import { getChatPrefs, patchChatPrefs, type ChatPrefs } from "./chat-home-api";

// 全局问候设置(GET/PATCH /api/chat-home/settings)的模块缓存:打开设置面板时取一次,超过 5 分钟再取;
// PATCH 成功后用响应覆盖。只放内存,登出清空(clearChatHomeCache)。

export const PREFS_STALE_MS = 5 * 60_000;

let cached: { prefs: ChatPrefs; at: number } | null = null;
const listeners = new Set<() => void>();
const publish = () => listeners.forEach((l) => l());

export function resetChatPrefsCache(): void {
  cached = null;
  publish();
}

export type PrefsStatus = "idle" | "loading" | "ready" | "error";

/** `active` = 设置面板打开。返回 prefs(可能是旧值)、状态、重试与保存。 */
export function useChatPrefs(active: boolean) {
  const { api } = useAuth();
  const [, force] = useState(0);
  const [status, setStatus] = useState<PrefsStatus>(cached ? "ready" : "idle");
  const aliveRef = useRef(true);
  useEffect(() => {
    aliveRef.current = true;
    const l = () => force((n) => n + 1);
    listeners.add(l);
    return () => { aliveRef.current = false; listeners.delete(l); };
  }, []);

  const load = useCallback(async () => {
    setStatus(cached ? "ready" : "loading");
    try {
      const prefs = await getChatPrefs(api);
      cached = { prefs, at: Date.now() };
      publish();
      if (aliveRef.current) setStatus("ready");
    } catch {
      if (aliveRef.current) setStatus(cached ? "ready" : "error");
    }
  }, [api]);

  useEffect(() => {
    if (active && (!cached || Date.now() - cached.at > PREFS_STALE_MS)) void load();
  }, [active, load]);

  /** 保存部分键;成功返回新设置,失败抛出(调用方回滚并提示)。 */
  const save = useCallback(async (partial: Partial<ChatPrefs>): Promise<ChatPrefs> => {
    const prefs = await patchChatPrefs(api, partial);
    cached = { prefs, at: Date.now() };
    publish();
    return prefs;
  }, [api]);

  return { prefs: cached?.prefs ?? null, status, retry: load, save };
}
