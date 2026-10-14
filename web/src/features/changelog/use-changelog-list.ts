import { useCallback, useEffect, useRef, useState } from "react";
import { useAuth } from "~/auth/auth-context";
import { kvGet, kvSet } from "~/lib/kv-cache";
import { fetchChangelog, parseChangelogPage, type ChangelogEntry } from "./api";

/** 内容是公开的发布说明,所以第一页可以放进本机缓存(退出登录时 kvClear 会清);键里没有用户信息。 */
export const CACHE_KEY = "changelog:v1:first-page";

export interface ChangelogList {
  status: "loading" | "ready" | "error";
  entries: ChangelogEntry[];
  latestId: number | null;
  hasMore: boolean;
  loadingMore: boolean;
  moreFailed: boolean;
  /** 首页请求失败,显示的是上次保存的第一页(不分页、不报已读、没有「新」角标) */
  offline: boolean;
  loadMore: () => void;
  reload: () => void;
}

interface State {
  status: ChangelogList["status"];
  entries: ChangelogEntry[];
  next: string | null;
  latestId: number | null;
  loadingMore: boolean;
  moreFailed: boolean;
  offline: boolean;
}
const LOADING: State = { status: "loading", entries: [], next: null, latestId: null, loadingMore: false, moreFailed: false, offline: false };

export function mergeEntries(current: ChangelogEntry[], more: ChangelogEntry[]): ChangelogEntry[] {
  const known = new Set(current.map((e) => e.id));
  return [...current, ...more.filter((e) => !known.has(e.id))];
}

export function useChangelogList(): ChangelogList {
  const { api } = useAuth();
  const [state, setState] = useState<State>(LOADING);
  const [tick, setTick] = useState(0);
  const stateRef = useRef(state);
  stateRef.current = state;
  const moreCtl = useRef<AbortController | null>(null);

  useEffect(() => {
    const ctl = new AbortController();
    moreCtl.current?.abort();
    moreCtl.current = null;
    setState(LOADING);
    fetchChangelog(api, { signal: ctl.signal }).then(
      (page) => {
        if (ctl.signal.aborted) return;
        void kvSet(CACHE_KEY, page);
        setState({ status: "ready", entries: page.entries, next: page.next, latestId: page.latestId, loadingMore: false, moreFailed: false, offline: false });
      },
      async () => {
        if (ctl.signal.aborted) return;
        const cached = parseChangelogPage(await kvGet<unknown>(CACHE_KEY));
        if (ctl.signal.aborted) return;
        if (cached.entries.length > 0) {
          setState({
            status: "ready", entries: cached.entries.map((e) => ({ ...e, isNew: false })), next: null, latestId: cached.latestId,
            loadingMore: false, moreFailed: false, offline: true,
          });
        } else {
          setState({ ...LOADING, status: "error" });
        }
      },
    );
    return () => {
      ctl.abort();
      moreCtl.current?.abort();
      moreCtl.current = null;
    };
  }, [api, tick]);

  const loadMore = useCallback(() => {
    const cursor = stateRef.current.next;
    if (!cursor || moreCtl.current) return;
    const ctl = new AbortController();
    moreCtl.current = ctl;
    setState((s) => ({ ...s, loadingMore: true, moreFailed: false }));
    fetchChangelog(api, { cursor, signal: ctl.signal })
      .then(
        (page) => {
          if (!ctl.signal.aborted) setState((s) => ({ ...s, entries: mergeEntries(s.entries, page.entries), next: page.next, loadingMore: false }));
        },
        () => {
          if (!ctl.signal.aborted) setState((s) => ({ ...s, loadingMore: false, moreFailed: true }));
        },
      )
      .finally(() => {
        if (moreCtl.current === ctl) moreCtl.current = null;
      });
  }, [api]);

  const reload = useCallback(() => setTick((n) => n + 1), []);
  return {
    status: state.status, entries: state.entries, latestId: state.latestId, hasMore: state.next !== null,
    loadingMore: state.loadingMore, moreFailed: state.moreFailed, offline: state.offline, loadMore, reload,
  };
}
