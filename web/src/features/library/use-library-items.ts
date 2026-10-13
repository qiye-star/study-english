import { useCallback, useEffect, useRef, useState } from "react";
import { useAuth } from "~/auth/auth-context";
import { listItems, type LibraryItem } from "./library-api";

export const POLL_MS = 3000;

export const isActive = (item: Pick<LibraryItem, "status">): boolean => item.status === "queued" || item.status === "processing";

/** 用新取的第一页更新列表:已有的就地更新,新出现的放最前,已加载的后续页保留(R-L11)。 */
export function mergeFirstPage(prev: readonly LibraryItem[], fresh: readonly LibraryItem[]): LibraryItem[] {
  const byId = new Map(fresh.map((i) => [i.id, i]));
  const known = new Set(prev.map((i) => i.id));
  return [...fresh.filter((i) => !known.has(i.id)), ...prev.map((i) => byId.get(i.id) ?? i)];
}

/** active 时每 ms 调一次 fn;页面隐藏时停,回到可见时先调一次再恢复。fn 的错误被吞掉(下一轮再试)。 */
export function usePolling(active: boolean, fn: () => Promise<unknown> | void, ms = POLL_MS, doc: Document = document): void {
  const fnRef = useRef(fn);
  fnRef.current = fn;
  useEffect(() => {
    if (!active) return;
    let timer: ReturnType<typeof setInterval> | null = null;
    const run = () => {
      try {
        void Promise.resolve(fnRef.current()).catch(() => {});
      } catch {
        /* 同上 */
      }
    };
    const start = () => {
      if (timer === null && doc.visibilityState !== "hidden") timer = setInterval(run, ms);
    };
    const stop = () => {
      if (timer !== null) clearInterval(timer);
      timer = null;
    };
    const onVisibility = () => {
      if (doc.visibilityState === "hidden") {
        stop();
      } else if (timer === null) {
        run();
        start();
      }
    };
    start();
    doc.addEventListener("visibilitychange", onVisibility);
    return () => {
      stop();
      doc.removeEventListener("visibilitychange", onVisibility);
    };
  }, [active, ms, doc]);
}

export interface LibraryItemsState {
  items: LibraryItem[];
  nextCursor: string | null;
  loading: boolean;
  loadingMore: boolean;
  error: unknown;
}

const INITIAL: LibraryItemsState = { items: [], nextCursor: null, loading: true, loadingMore: false, error: null };

export function useLibraryItems(enabled: boolean) {
  const { api } = useAuth();
  const [state, setState] = useState<LibraryItemsState>(INITIAL);
  const cursorRef = useRef<string | null>(null);
  cursorRef.current = state.nextCursor;

  const reload = useCallback(async () => {
    setState((s) => ({ ...s, loading: true, error: null }));
    try {
      const page = await listItems(api);
      setState({ items: page.items, nextCursor: page.nextCursor, loading: false, loadingMore: false, error: null });
    } catch (error) {
      setState((s) => ({ ...s, loading: false, error }));
    }
  }, [api]);

  useEffect(() => {
    if (enabled) void reload();
  }, [enabled, reload]);

  const refresh = useCallback(async () => {
    const page = await listItems(api);
    setState((s) => ({ ...s, items: mergeFirstPage(s.items, page.items) }));
  }, [api]);

  usePolling(enabled && state.items.some(isActive), refresh);

  const loadMore = useCallback(async () => {
    const cursor = cursorRef.current;
    if (!cursor) return;
    setState((s) => ({ ...s, loadingMore: true }));
    try {
      const page = await listItems(api, cursor);
      setState((s) => {
        const known = new Set(s.items.map((i) => i.id));
        return { ...s, items: [...s.items, ...page.items.filter((i) => !known.has(i.id))], nextCursor: page.nextCursor, loadingMore: false };
      });
    } catch (error) {
      setState((s) => ({ ...s, loadingMore: false, error }));
    }
  }, [api]);

  const replace = useCallback((item: LibraryItem) => {
    setState((s) => ({
      ...s,
      items: s.items.some((i) => i.id === item.id) ? s.items.map((i) => (i.id === item.id ? item : i)) : [item, ...s.items],
    }));
  }, []);

  const remove = useCallback((id: string) => {
    setState((s) => ({ ...s, items: s.items.filter((i) => i.id !== id) }));
  }, []);

  return { ...state, reload, refresh, loadMore, replace, remove };
}
