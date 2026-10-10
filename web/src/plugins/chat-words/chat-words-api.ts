import { useEffect, useState } from "react";
import type { ApiClient } from "~/api/client";
import { useAuth } from "~/auth/auth-context";

export interface ChatWordsItem { word: string; used: boolean }
export interface ChatWords { today: ChatWordsItem[]; usedCount: number }

const REUSE_MS = 30_000;
const cache = new WeakMap<ApiClient, { at: number; promise: Promise<ChatWords> }>();

/**
 * GET /api/links/chat-words(今日词 + 是否已在对话里用过)。同一个 ApiClient 30 秒内复用同一次请求
 * (今日任务行与多张词卡小标共用);失败的请求不缓存。`signal` 只影响本次调用者,不取消共享请求。
 */
export function fetchChatWords(api: ApiClient, signal?: AbortSignal): Promise<ChatWords> {
  const now = Date.now();
  let hit = cache.get(api);
  if (!hit || now - hit.at >= REUSE_MS) {
    const promise = api.request<ChatWords>("GET", "/api/links/chat-words", {
      query: { offset: -new Date().getTimezoneOffset() },
    });
    hit = { at: now, promise };
    cache.set(api, hit);
    promise.catch(() => { if (cache.get(api)?.promise === promise) cache.delete(api); });
  }
  const shared = hit.promise;
  if (!signal) return shared;
  return new Promise<ChatWords>((resolve, reject) => {
    if (signal.aborted) { reject(signal.reason); return; }
    signal.addEventListener("abort", () => reject(signal.reason), { once: true });
    shared.then(resolve, reject);
  });
}

/** 组件用:加载中 / 失败 = null(联动尽力而为,失败时不显示任何东西)。 */
export function useChatWords(): ChatWords | null {
  const { api } = useAuth();
  const [data, setData] = useState<ChatWords | null>(null);
  useEffect(() => {
    const controller = new AbortController();
    fetchChatWords(api, controller.signal).then(
      (body) => { if (!controller.signal.aborted) setData(body); },
      () => {},
    );
    return () => controller.abort();
  }, [api]);
  return data;
}
