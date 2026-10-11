import { useCallback, useEffect, useRef, useState } from "react";

/** 按 deps 加载一次(切换 deps 时先清空)+ retry + 本地改写(删除 / 置顶后不重新请求)。 */
export function useLoad<T>(load: (signal: AbortSignal) => Promise<T>, deps: readonly unknown[]) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [attempt, setAttempt] = useState(0);
  const keep = useRef(false);
  useEffect(() => {
    const controller = new AbortController();
    if (!keep.current) setData(null);
    keep.current = false;
    setError(null);
    load(controller.signal).then(
      (value) => { if (!controller.signal.aborted) setData(value); },
      (err: unknown) => { if (!controller.signal.aborted) setError(err); },
    );
    return () => controller.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, attempt]);
  const retry = useCallback(() => setAttempt((n) => n + 1), []);
  /** 重新取但保留当前数据(取回之前界面不闪成加载中) */
  const refresh = useCallback(() => { keep.current = true; setAttempt((n) => n + 1); }, []);
  return { data, setData, error, retry, refresh };
}
