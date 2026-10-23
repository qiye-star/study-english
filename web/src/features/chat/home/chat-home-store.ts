import { useSyncExternalStore } from "react";
import type { ApiClient } from "~/api/client";
import { localDateString, tzOffsetMinutes } from "~/lib/tz-offset";
import { postToday, type TodayResult } from "./chat-home-api";
import { onChatHomeReset } from "./chat-home-cache";

// 今天的 `/today` 结果(只放内存,登出清空;不进 localStorage,不含任何日志输出)。
// 网络动作(requestToday / rebuildToday)也在这里,打开检测(chat-home-open.ts)只负责「何时调用」。

export type HomePhase = "idle" | "loading" | "ready" | "error";
export interface ChatHomeState {
  phase: HomePhase;
  today: TodayResult | null;
  /** `today.localDate`(用户本地日);跨午夜检测用 */
  localDate: string | null;
  /** 每发生一次「打开」加 1 */
  openSeq: number;
  /** 本次打开待弹:进入 `/chat` 时消费(不持久化,R8) */
  pendingModal: boolean;
}

/** `pending` 的重试(R5):1.5 s 一次,最多 4 次。 */
export const PENDING_RETRY_MS = 1500;
export const PENDING_MAX_RETRIES = 4;

const INITIAL: ChatHomeState = { phase: "idle", today: null, localDate: null, openSeq: 0, pendingModal: false };
let state: ChatHomeState = INITIAL;
const listeners = new Set<() => void>();
let inflight: { promise: Promise<void>; controller: AbortController; open: boolean } | null = null;

function set(patch: Partial<ChatHomeState>): void {
  state = { ...state, ...patch };
  listeners.forEach((l) => l());
}

export const getChatHomeState = (): ChatHomeState => state;
export function subscribeChatHome(listener: () => void): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}
export const useChatHomeState = (): ChatHomeState => useSyncExternalStore(subscribeChatHome, getChatHomeState, getChatHomeState);

export function newRequestId(): string {
  const c = globalThis.crypto;
  if (c?.randomUUID) return c.randomUUID();
  const hex = (n: number) => Array.from({ length: n }, () => Math.floor(Math.random() * 16).toString(16)).join("");
  return `${hex(8)}-${hex(4)}-4${hex(3)}-a${hex(3)}-${hex(12)}`;
}

const wait = (ms: number, signal: AbortSignal) => new Promise<void>((resolve) => {
  const timer = window.setTimeout(resolve, ms);
  signal.addEventListener("abort", () => { window.clearTimeout(timer); resolve(); }, { once: true });
});

async function run(api: ApiClient, controller: AbortController, open: boolean, requestId: string): Promise<void> {
  const { signal } = controller;
  try {
    let result: TodayResult | null = null;
    // 重试复用同一个 client_request_id(服务端据此去重)
    for (let attempt = 0; attempt <= PENDING_MAX_RETRIES; attempt++) {
      if (attempt > 0) {
        await wait(PENDING_RETRY_MS, signal);
        if (signal.aborted) return;
      }
      result = await postToday(api, { tzOffsetMinutes: tzOffsetMinutes(), clientRequestId: requestId }, signal);
      if (signal.aborted) return;
      if (result.status !== "pending") break;
    }
    if (!result) return;
    // 仍 pending:对话已存在,本次打开不弹(标记保留,下次进入 /chat 时重新请求一次)
    set({
      phase: "ready", today: result, localDate: result.localDate,
      ...(open ? { openSeq: state.openSeq + 1, pendingModal: true } : {}),
    });
  } catch {
    if (signal.aborted) return;
    // 网络失败:不弹、不重试风暴;对话主页显示「加载失败 · 重试」。绝不在客户端造对话。
    set({ phase: "error" });
  } finally {
    if (inflight?.controller === controller) inflight = null;
  }
}

/**
 * `POST /today`。`open` = 这是一次「打开」(置位待弹并让 openSeq + 1)。
 * 同一时间只有一个请求:已有「打开」请求在途时再来一次「打开」直接共用它。
 */
export function requestToday(api: ApiClient, opts: { open: boolean }): Promise<void> {
  if (inflight && (inflight.open || !opts.open)) return inflight.promise;
  inflight?.controller.abort();
  const controller = new AbortController();
  if (state.today === null || state.localDate !== localDateString()) set({ phase: "loading" });
  const promise = run(api, controller, opts.open, newRequestId());
  inflight = { promise, controller, open: opts.open };
  return promise;
}

/**
 * 删除今天的对话之后:清空结果并立即重新 `POST /today`(新的 client_request_id)。
 * 这不是一次「打开」:不置 pendingModal、不加 openSeq,所以不会弹窗(FR7、FR10)。服务端按 R4 重建并写回问候。
 */
export function rebuildToday(api: ApiClient): Promise<void> {
  inflight?.controller.abort();
  inflight = null;
  set({ phase: "loading", today: null, localDate: null });
  return requestToday(api, { open: false });
}

/** 弹出即消费(只在 /chat 判断条件后调用)。 */
export function consumePendingModal(): void {
  if (state.pendingModal) set({ pendingModal: false });
}

/** 关闭「问候里提学习数据」成功后:与服务端读取规则一致,今天问候的 facts 本地置空(R16)。 */
export function clearGreetingFacts(): void {
  const today = state.today;
  if (!today?.greeting) return;
  set({ today: { ...today, greeting: { ...today.greeting, facts: {} } } });
}

/** 登出清理:取消在途请求,回到初始状态。 */
export function resetChatHomeStore(): void {
  inflight?.controller.abort();
  inflight = null;
  state = INITIAL;
  listeners.forEach((l) => l());
}

onChatHomeReset(resetChatHomeStore);
