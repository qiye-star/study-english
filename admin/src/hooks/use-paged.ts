import { useCallback, useEffect, useRef, useState } from "react";
import { errorText } from "./use-async";

export interface PagedResult<T> {
  items: T[];
  total?: number;
  /** 首屏加载中 */
  loading: boolean;
  loadingMore: boolean;
  /** 首屏错误(无数据可展示) */
  error: string | null;
  /** 加载更多出错(保留已有数据) */
  moreError: string | null;
  hasMore: boolean;
  loadMore: () => void;
  reload: () => void;
}

interface PageData<T> {
  items: T[];
  next: number | null;
  total?: number;
}

/** "加载更多"式分页。deps 变化(搜索词、筛选)时从第 1 页重来。 */
export function usePaged<T>(fetchPage: (page: number) => Promise<PageData<T>>, deps: readonly unknown[]): PagedResult<T> {
  const [items, setItems] = useState<T[]>([]);
  const [next, setNext] = useState<number | null>(null);
  const [total, setTotal] = useState<number | undefined>();
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [moreError, setMoreError] = useState<string | null>(null);
  const [tick, setTick] = useState(0);
  const fetchRef = useRef(fetchPage);
  fetchRef.current = fetchPage;
  const gen = useRef(0);

  useEffect(() => {
    const my = ++gen.current;
    setLoading(true);
    setLoadingMore(false);
    setError(null);
    setMoreError(null);
    setItems([]);
    setNext(null);
    fetchRef.current(1).then(
      (r) => {
        if (my !== gen.current) return;
        setItems(r.items);
        setNext(r.next);
        setTotal(r.total);
        setLoading(false);
      },
      (e) => {
        if (my !== gen.current) return;
        setError(errorText(e));
        setLoading(false);
      },
    );
    return () => {
      gen.current++;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, tick]);

  const loadMore = useCallback(() => {
    if (next === null || loadingMore) return;
    const my = gen.current;
    setLoadingMore(true);
    setMoreError(null);
    fetchRef.current(next).then(
      (r) => {
        if (my !== gen.current) return;
        setItems((prev) => [...prev, ...r.items]);
        setNext(r.next);
        setLoadingMore(false);
      },
      (e) => {
        if (my !== gen.current) return;
        setMoreError(errorText(e));
        setLoadingMore(false);
      },
    );
  }, [next, loadingMore]);

  const reload = useCallback(() => setTick((t) => t + 1), []);
  return { items, total, loading, loadingMore, error, moreError, hasMore: next !== null, loadMore, reload };
}
