import { useCallback, useEffect, useRef, useState } from "react";
import { ApiError } from "~/api/client";
import { useAuth } from "~/auth/auth-context";
import { addCatalogItem, listCatalog, type CatalogAdd, type CatalogCard } from "./catalog-api";

export interface CatalogState {
  items: CatalogCard[];
  loading: boolean;
  error: unknown;
}

/**
 * 精选目录(R-W3:一次取完,级别筛选在客户端)。`add(id)`:并发点同一张卡只发一次;成功后把该卡的 `addedItemId`
 * 就地改成新副本 id(不重取列表);404(条目已下架)时把这张卡从列表里立即去掉,错误照抛给调用方弹吐司(裁定 4)。
 */
export function useCatalog(enabled: boolean) {
  const { api } = useAuth();
  const [state, setState] = useState<CatalogState>({ items: [], loading: true, error: null });
  const [adding, setAdding] = useState<ReadonlySet<string>>(new Set());
  const inflight = useRef(new Map<string, Promise<CatalogAdd>>());

  const reload = useCallback(async (signal?: AbortSignal) => {
    setState((s) => ({ ...s, loading: true, error: null }));
    try {
      const items = await listCatalog(api, signal);
      if (!signal?.aborted) setState({ items, loading: false, error: null });
    } catch (error) {
      if (!signal?.aborted) setState((s) => ({ ...s, loading: false, error }));
    }
  }, [api]);

  useEffect(() => {
    if (!enabled) return;
    const ctl = new AbortController();
    void reload(ctl.signal);
    return () => ctl.abort();
  }, [enabled, reload]);

  const add = useCallback((id: string): Promise<CatalogAdd> => {
    const running = inflight.current.get(id);
    if (running) return running;
    setAdding((s) => new Set(s).add(id));
    const run = addCatalogItem(api, id).then(
      (out) => {
        setState((s) => ({ ...s, items: s.items.map((c) => (c.id === id ? { ...c, addedItemId: out.item.id } : c)) }));
        return out;
      },
      (err: unknown) => {
        if (err instanceof ApiError && err.status === 404) setState((s) => ({ ...s, items: s.items.filter((c) => c.id !== id) }));
        throw err;
      },
    ).finally(() => {
      inflight.current.delete(id);
      setAdding((s) => {
        const next = new Set(s);
        next.delete(id);
        return next;
      });
    });
    inflight.current.set(id, run);
    return run;
  }, [api]);

  return { ...state, adding, add, reload: () => reload() };
}
