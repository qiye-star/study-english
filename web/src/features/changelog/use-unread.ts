import { useEffect, useSyncExternalStore } from "react";
import { useAuth } from "~/auth/auth-context";
import { refreshUnread, subscribeUnread, unreadSnapshot, type UnreadState } from "./unread-store";

/** 入口用:挂载时刷新(60 秒内不重复),按当前 api + 用户读状态。 */
export function useChangelogUnread(): UnreadState {
  const { api, user } = useAuth();
  const userId = user?.id ?? null;
  const state = useSyncExternalStore(subscribeUnread, () => unreadSnapshot(api, userId), () => unreadSnapshot(api, userId));
  useEffect(() => {
    void refreshUnread(api, userId);
  }, [api, userId]);
  return state;
}
