import type { ApiClient } from "~/api/client";
import { localDateString } from "~/lib/tz-offset";
import { getChatHomeState, requestToday } from "./chat-home-store";

/** 「打开」= 冷启动,或从后台回到前台且隐藏 ≥ 30 分钟(`online` 事件不算,FR10)。 */
export const RESUME_GAP_MS = 30 * 60_000;

export interface OpenEnv {
  doc: Pick<Document, "addEventListener" | "removeEventListener" | "visibilityState">;
  now: () => number;
}
const defaultEnv = (): OpenEnv => ({ doc: document, now: () => Date.now() });

/**
 * 开始监听「打开」并立刻处理冷启动那一次(调用方已确认开关为开)。返回停止函数。
 * 只发 `POST /today`;何时弹窗由对话主页决定(只在 /chat,FR10)。
 */
export function startOpenDetection(api: ApiClient, env: OpenEnv = defaultEnv()): () => void {
  let hiddenAt: number | null = env.doc.visibilityState === "hidden" ? env.now() : null;
  void requestToday(api, { open: true });
  const onVisibility = () => {
    if (env.doc.visibilityState === "hidden") {
      hiddenAt = env.now();
      return;
    }
    const since = hiddenAt;
    hiddenAt = null;
    if (since !== null && env.now() - since >= RESUME_GAP_MS) void requestToday(api, { open: true });
  };
  env.doc.addEventListener("visibilitychange", onVisibility);
  return () => env.doc.removeEventListener("visibilitychange", onVisibility);
}

/**
 * 进入 `/chat` 时调用:跨过本地午夜而 App 一直在前台、或上一次仍是 pending 时,按一次新的「打开」重新请求。
 * 返回是否发起了请求。
 */
export function refreshOnEnter(api: ApiClient, today: string = localDateString()): boolean {
  const s = getChatHomeState();
  if (s.phase === "idle" || s.phase === "loading") return false; // 还没有结果 / 正在请求
  const staleDay = s.localDate !== null && s.localDate !== today;
  const stillPending = s.today?.status === "pending";
  if (!staleDay && !stillPending) return false;
  void requestToday(api, { open: true });
  return true;
}
