import { useCallback, useEffect, useState } from "react";
import { useAuth } from "~/auth/auth-context";
import { fetchToday, type Today } from "./wordbook-api";

/**
 * 今日计划(`GET /api/wordbook/today`)。`enabled` 为假时不请求;失败时 error 为原始错误、today 保持 null。
 * reload() 重新请求(如换书后)。
 */
export function useWordbookToday(enabled: boolean) {
  const { api } = useAuth();
  const [today, setToday] = useState<Today | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    if (!enabled) return;
    const controller = new AbortController();
    setError(null);
    fetchToday(api, controller.signal).then(
      (value) => { if (!controller.signal.aborted) setToday(value); },
      (err: unknown) => { if (!controller.signal.aborted) setError(err); },
    );
    return () => controller.abort();
  }, [api, enabled, attempt]);
  const reload = useCallback(() => setAttempt((n) => n + 1), []);
  return { today, error, reload };
}
