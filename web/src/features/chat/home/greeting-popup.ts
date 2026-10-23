import { useCallback, useEffect, useRef, useState } from "react";
import type { ApiClient } from "~/api/client";
import { markGreetingSeen, type TodayGreeting } from "./chat-home-api";
import { CHAT_HOME_SHOWN_KEY } from "./chat-home-cache";
import { consumePendingModal, useChatHomeState } from "./chat-home-store";
import { ensureChatPrefs } from "./use-chat-prefs";

// 问候时机(FR10):只在对话主页 `/chat`(调用方只在 kind="today" 时启用)。daily / every_open / off 的判断都在这里;
// 重播(设置面板)不经过这些规则:不调 /today、不调 seen、不写本机标记、不追加消息。

function readShown(): string | null {
  try {
    return window.localStorage.getItem(CHAT_HOME_SHOWN_KEY);
  } catch {
    return null;
  }
}
function writeShown(day: string): void {
  try {
    window.localStorage.setItem(CHAT_HOME_SHOWN_KEY, day); // 只存日期
  } catch {
    /* 存储不可用:daily 的本机防重失效,服务端 first_view 仍然生效 */
  }
}

export type PopupMode = "open" | "replay";

/**
 * 弹窗是否出现:`pendingModal && ready && 恰好 3 行 && trigger !== off`,daily 另需 `firstView` 且本机今天没弹过;
 * every_open 不看 firstView(只重放弹窗,不追加消息)。判断完就消费「本次打开待弹」标记(status=pending 时保留,等重取)。
 */
export function useGreetingPopup(api: ApiClient, enabled: boolean) {
  const home = useChatHomeState();
  const [mode, setMode] = useState<PopupMode | null>(null);
  const greetingRef = useRef<TodayGreeting | null>(null);
  const localDateRef = useRef("");
  const today = home.today;
  greetingRef.current = today?.greeting ?? null;
  localDateRef.current = today?.localDate ?? "";

  const pending = enabled && home.pendingModal && home.phase === "ready" && !!today && today.status !== "pending";
  useEffect(() => {
    if (!pending || !today) return;
    const greeting = today.greeting;
    if (!greeting || greeting.lines.length !== 3) {
      consumePendingModal();
      return;
    }
    let alive = true;
    void ensureChatPrefs(api).then((prefs) => {
      if (!alive) return;
      consumePendingModal();
      const trigger = prefs?.greetingTrigger ?? "daily";
      if (trigger === "off") return;
      if (trigger === "daily") {
        if (!greeting.firstView) return;
        if (readShown() === today.localDate) {
          void markGreetingSeen(api, greeting.id).catch((): void => undefined); // seen 上次没成功时的一次静默重试
          return;
        }
      }
      setMode("open");
    });
    return () => { alive = false; };
  }, [pending, today, api]);

  /** 弹窗出现时调用一次:open 模式上报 seen(幂等)并写本机日期;replay 什么都不做。 */
  const onShown = useCallback(() => {
    if (mode !== "open") return;
    const greeting = greetingRef.current;
    writeShown(localDateRef.current);
    if (greeting) void markGreetingSeen(api, greeting.id).catch((): void => undefined);
  }, [api, mode]);

  return { mode, replay: () => setMode("replay"), close: () => setMode(null), onShown };
}
