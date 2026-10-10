import { useCallback, useEffect, useRef, useState } from "react";
import { useAuth } from "~/auth/auth-context";
import { fetchToday, type Today } from "./wordbook-api";

/**
 * 今日计划(`GET /api/wordbook/today`)。`enabled` 为假时不请求;失败时 error 为原始错误、today 保持 null。
 * reload() 重新请求(如换书后)。
 */
export const TODAY_RETRY_MS = 3_000;

export function useWordbookToday(enabled: boolean) {
  const { api } = useAuth();
  const [today, setToday] = useState<Today | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [attempt, setAttempt] = useState(0);
  // 一次失败(移动网络抖动)不该让练习页的卡片与「我的」那一行整次访问都消失:自动再试一次(review m13)
  const autoRetried = useRef(false);
  useEffect(() => {
    if (!enabled) return;
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    setError(null);
    fetchToday(api, controller.signal).then(
      (value) => { if (!controller.signal.aborted) setToday(value); },
      (err: unknown) => {
        if (controller.signal.aborted) return;
        setError(err);
        if (!autoRetried.current) {
          autoRetried.current = true;
          timer = setTimeout(() => setAttempt((n) => n + 1), TODAY_RETRY_MS);
        }
      },
    );
    return () => {
      controller.abort();
      if (timer) clearTimeout(timer);
    };
  }, [api, enabled, attempt]);
  const reload = useCallback(() => setAttempt((n) => n + 1), []);
  return { today, error, reload };
}
