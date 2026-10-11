import { useCallback, useEffect, useRef, useState } from "react";
import { useAuth } from "~/auth/auth-context";
import { fetchLearned, fetchLearnedSummary, type LearnedItem, type LearnedQuery, type LearnedSummary } from "./wordbook-api";

/** `GET /api/wordbook/learned/summary`。`enabled` 为假时不请求;失败时 error 为原始错误、summary 保持 null。 */
export function useLearnedSummary(enabled: boolean) {
  const { api } = useAuth();
  const [summary, setSummary] = useState<LearnedSummary | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    if (!enabled) return;
    const controller = new AbortController();
    setError(null);
    fetchLearnedSummary(api, controller.signal).then(
      (value) => { if (!controller.signal.aborted) setSummary(value); },
      (err: unknown) => { if (!controller.signal.aborted) setError(err); },
    );
    return () => controller.abort();
  }, [api, enabled, attempt]);
  return { summary, error, reload: useCallback(() => setAttempt((n) => n + 1), []) };
}

/** 输入框防抖:前缀搜索只在停手 `ms` 之后才发请求。 */
export function useDebounced<T>(value: T, ms: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const id = setTimeout(() => setDebounced(value), ms);
    return () => clearTimeout(id);
  }, [value, ms]);
  return debounced;
}

type Status = "loading" | "idle" | "more" | "error";

/**
 * 已学词分页列表(`POST /api/wordbook/learned/query`,游标)。筛选条件变化 → 从头加载,旧请求的结果丢弃;
 * `loadMore` 带上一页的 cursor 追加。每页 50 条(服务端默认)。
 */
export function useLearnedList(query: Omit<LearnedQuery, "cursor" | "limit">) {
  const { api } = useAuth();
  const [items, setItems] = useState<LearnedItem[]>([]);
  const [next, setNext] = useState<string | null>(null);
  const [status, setStatus] = useState<Status>("loading");
  const [error, setError] = useState<unknown>(null);
  const [attempt, setAttempt] = useState(0);
  const run = useRef(0);
  const key = JSON.stringify(query);
  useEffect(() => {
    const id = ++run.current;
    const controller = new AbortController();
    setStatus("loading");
    setError(null);
    fetchLearned(api, JSON.parse(key) as LearnedQuery, controller.signal).then(
      (page) => {
        if (run.current !== id) return;
        setItems(page.items);
        setNext(page.nextCursor);
        setStatus("idle");
      },
      (err: unknown) => {
        if (run.current !== id || controller.signal.aborted) return;
        setError(err);
        setStatus("error");
      },
    );
    return () => controller.abort();
  }, [api, key, attempt]);
  const loadMore = useCallback(async () => {
    if (!next || status !== "idle") return;
    const id = run.current;
    setStatus("more");
    try {
      const page = await fetchLearned(api, { ...(JSON.parse(key) as LearnedQuery), cursor: next });
      if (run.current !== id) return;
      setItems((prev) => [...prev, ...page.items]);
      setNext(page.nextCursor);
      setStatus("idle");
    } catch (err) {
      if (run.current !== id) return;
      setError(err);
      setStatus("error");
    }
  }, [api, key, next, status]);
  return { items, status, error, hasMore: next !== null, loadMore, reload: useCallback(() => setAttempt((n) => n + 1), []) };
}
