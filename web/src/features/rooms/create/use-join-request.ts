import { useCallback, useEffect, useRef, useState } from "react";
import { ApiError, type ApiClient } from "~/api/client";
import type { JoinRequestInfo } from "../protocol";
import { cancelJoinRequest, getJoinRequest } from "./rooms-v2-api";

/** 轮询间隔与上限(spec §3.4:每 3 秒、页面可见时、最长 10 分钟)。 */
export const JOIN_POLL_MS = 3000;
export const JOIN_POLL_MAX_MS = 10 * 60 * 1000;

export type JoinOutcome = "denied" | "expired";

/**
 * 请求者等待房主同意:setTimeout 链(不是 setInterval)每 3 秒 GET 一次,请求带 AbortController;页面隐藏时暂停、
 * 回到前台立刻再查。approved → onApproved(roomId);denied / expired → outcome;cancelled → 卡片消失;
 * 10 分钟后停止并显示过期;卸载时停止。
 */
export function useJoinRequest(api: ApiClient, onApproved: (roomId: string) => void) {
  const [request, setRequest] = useState<JoinRequestInfo | null>(null);
  const [outcome, setOutcome] = useState<JoinOutcome | null>(null);
  const approved = useRef(onApproved);
  approved.current = onApproved;
  const requestId = request?.id ?? null;

  useEffect(() => {
    if (!requestId) return;
    const deadline = Date.now() + JOIN_POLL_MAX_MS;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let ctrl: AbortController | null = null;
    let stopped = false;
    const finish = (next: JoinOutcome | null) => {
      stopped = true;
      setRequest(null);
      setOutcome(next);
    };
    const schedule = () => {
      if (!stopped) timer = setTimeout(tick, JOIN_POLL_MS);
    };
    async function tick() {
      timer = undefined;
      if (stopped) return;
      if (Date.now() >= deadline) return finish("expired");
      if (document.visibilityState === "hidden") return; // visibilitychange 再接上
      ctrl = new AbortController();
      try {
        const r = await getJoinRequest(api, requestId!, ctrl.signal);
        if (stopped) return;
        if (r.status === "approved") {
          stopped = true;
          setRequest(null);
          approved.current(r.roomId);
          return;
        }
        if (r.status === "denied" || r.status === "expired") return finish(r.status);
        if (r.status === "cancelled") return finish(null);
      } catch (err) {
        if (stopped) return;
        if (err instanceof ApiError && err.status === 404) return finish("expired");
        // 网络抖动:下一轮再试
      } finally {
        ctrl = null;
      }
      schedule();
    }
    const onVisible = () => {
      if (document.visibilityState === "visible" && !stopped && !timer && !ctrl) void tick();
    };
    document.addEventListener("visibilitychange", onVisible);
    schedule();
    return () => {
      stopped = true;
      if (timer) clearTimeout(timer);
      ctrl?.abort();
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [api, requestId]);

  const start = useCallback((r: JoinRequestInfo) => {
    setOutcome(null);
    setRequest(r);
  }, []);
  /** 撤回:成功或请求已不存在都让卡片消失;其他错误抛给调用方提示。 */
  const cancel = useCallback(async () => {
    if (!requestId) return;
    try {
      await cancelJoinRequest(api, requestId);
    } catch (err) {
      if (!(err instanceof ApiError && err.status === 404)) throw err;
    }
    setRequest(null);
    setOutcome(null);
  }, [api, requestId]);
  const dismiss = useCallback(() => setOutcome(null), []);
  return { request, outcome, start, cancel, dismiss };
}
