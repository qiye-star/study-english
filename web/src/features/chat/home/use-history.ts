import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import type { ApiClient } from "~/api/client";
import { translateServerError } from "~/api/error-messages";
import { tzOffsetMinutes } from "~/lib/tz-offset";
import { CHAT_SERVER_ERRORS, listConversations, type Conversation } from "../chat-api";

const PER_PAGE = 20;

/**
 * 抽屉里的历史列表:每次打开(`active` 变 true)刷新第 1 页;「加载更多」按 id 去重、连点只取一次(同旧列表)。
 * 请求带 hide_idle_daily=true 与 tz_offset_minutes,URL 里没有任何对话内容。
 */
export function useHistory(api: ApiClient, active: boolean) {
  const { t } = useTranslation();
  const tRef = useRef(t);
  tRef.current = t;
  const [items, setItems] = useState<Conversation[]>([]);
  const [next, setNext] = useState<number | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const loadingRef = useRef(false);
  const aliveRef = useRef(true);
  useEffect(() => { aliveRef.current = true; return () => { aliveRef.current = false; }; }, []);

  const load = useCallback(async (page: number) => {
    if (loadingRef.current) return;
    loadingRef.current = true;
    setLoadingMore(page > 1);
    setError(null);
    try {
      const res = await listConversations(api, page, PER_PAGE, { hideIdleDaily: true, tzOffsetMinutes: tzOffsetMinutes() });
      if (!aliveRef.current) return;
      setItems((prev) => {
        const base = page === 1 ? [] : prev;
        const seen = new Set(base.map((c) => c.id));
        return [...base, ...res.conversations.filter((c) => !seen.has(c.id))];
      });
      setNext(res.next);
    } catch (err) {
      if (aliveRef.current) setError(translateServerError(tRef.current, err, CHAT_SERVER_ERRORS));
    } finally {
      loadingRef.current = false;
      if (aliveRef.current) {
        setLoadingMore(false);
        setLoaded(true);
      }
    }
  }, [api]);

  useEffect(() => {
    if (active) void load(1);
  }, [active, load]);

  return {
    items, loaded, error, next, loadingMore,
    reload: () => load(1),
    loadMore: () => { if (next) void load(next); },
    remove: (id: string) => setItems((prev) => prev.filter((c) => c.id !== id)),
  };
}
