import { useCallback, useEffect, useState } from "react";
import type { ApiClient } from "~/api/client";
import type { GateState } from "~/components/feature-gate";
import { endedRooms, type MyRoom } from "../rooms-api";

/** 已结束页的数据:首页 + 游标分页(按 id 去重,翻页期间有房间被重新开启或退出也不会重复)。 */
export function useEndedRooms(api: ApiClient) {
  const [rooms, setRooms] = useState<MyRoom[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [state, setState] = useState<GateState>("loading");
  const [loadingMore, setLoadingMore] = useState(false);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    const ctrl = new AbortController();
    setState("loading");
    endedRooms(api, null, ctrl.signal)
      .then((page) => { setRooms(page.rooms); setCursor(page.nextCursor); setState("ready"); })
      .catch(() => { if (!ctrl.signal.aborted) setState("error"); });
    return () => ctrl.abort();
  }, [api, attempt]);
  const loadMore = useCallback(async () => {
    if (!cursor || loadingMore) return;
    setLoadingMore(true);
    try {
      const page = await endedRooms(api, cursor);
      setRooms((cur) => { const seen = new Set(cur.map((r) => r.id)); return [...cur, ...page.rooms.filter((r) => !seen.has(r.id))]; });
      setCursor(page.nextCursor);
    } catch {
      setState("error");
    } finally {
      setLoadingMore(false);
    }
  }, [api, cursor, loadingMore]);
  return { rooms, state, hasMore: cursor !== null, loadingMore, loadMore, reload: () => setAttempt((n) => n + 1) };
}
