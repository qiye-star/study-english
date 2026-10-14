import type { ApiClient } from "~/api/client";
import { fetchChangelog, postSeen } from "./api";

/**
 * 更新日志入口的未读数(计划 2026-10-14-changelog R-14):一个很小的内存 store,按「ApiClient 实例 + 用户 id」分区
 * (AuthProvider 的 api 在登出 / 登录之间是同一个对象,所以必须带用户 id);60 秒内不重复请求,飞行中的请求去重。
 * 入口只要 `unread` 与 `latestId`,所以请求是 `?limit=1`。失败不抛(入口就不显示)。不含任何条目文字。
 */
export interface UnreadState { status: "idle" | "loading" | "ready" | "error"; unread: number; latestId: number | null }

const IDLE: UnreadState = Object.freeze({ status: "idle", unread: 0, latestId: null });
const FRESH_MS = 60_000;

/** 页面打开后多久标记已读(spec §2.2:1 秒)。 */
export const SEEN_DELAY_MS = 1000;
let seenDelay = SEEN_DELAY_MS;
export const seenDelayMs = (): number => seenDelay;
/** 仅测试:把延迟改短;不传 = 恢复默认。 */
export function setSeenDelayForTests(ms?: number): void {
  seenDelay = ms ?? SEEN_DELAY_MS;
}

interface Owner { api: ApiClient; userId: string | null }
let owner: Owner | null = null;
let state: UnreadState = IDLE;
let loadedAt = 0;
let inflight: Promise<void> | null = null;
const listeners = new Set<() => void>();

function emit(next: UnreadState): void {
  state = next;
  for (const fn of [...listeners]) fn();
}

const owns = (api: ApiClient, userId: string | null): boolean => owner !== null && owner.api === api && owner.userId === userId;

export function subscribeUnread(fn: () => void): () => void {
  listeners.add(fn);
  return () => { listeners.delete(fn); };
}

/** 这个 api + 用户的状态;别人的状态不外泄(用户切换时第一帧也不会闪出上一个人的红点)。 */
export function unreadSnapshot(api: ApiClient, userId: string | null): UnreadState {
  return owns(api, userId) ? state : IDLE;
}

export function refreshUnread(api: ApiClient, userId: string | null, force = false): Promise<void> {
  if (!owns(api, userId)) {
    owner = { api, userId };
    loadedAt = 0;
    inflight = null;
    emit(IDLE);
  }
  if (inflight) return inflight;
  if (!force && state.status === "ready" && Date.now() - loadedAt < FRESH_MS) return Promise.resolve();
  const mine = owner;
  if (state.status !== "ready") emit({ ...state, status: "loading" });
  const request: Promise<void> = fetchChangelog(api, { limit: 1 })
    .then(
      (page) => {
        if (owner !== mine) return;
        loadedAt = Date.now();
        emit({ status: "ready", unread: page.unread, latestId: page.latestId });
      },
      () => {
        if (owner === mine && state.status !== "ready") emit({ ...state, status: "error" });
      },
    )
    .finally(() => {
      if (inflight === request) inflight = null;
    });
  inflight = request;
  return request;
}

/** 日志页调用:把已读位置报给服务端,成功后直接用返回的未读数更新红点;失败静默(下次打开页面再报)。 */
export async function markSeen(api: ApiClient, userId: string | null, uptoId: number): Promise<void> {
  try {
    const result = await postSeen(api, uptoId);
    if (owns(api, userId)) emit({ ...state, unread: result.unread });
  } catch {
    /* 下次打开页面再报 */
  }
}

export function resetUnreadForTests(): void {
  owner = null;
  state = IDLE;
  loadedAt = 0;
  inflight = null;
}
