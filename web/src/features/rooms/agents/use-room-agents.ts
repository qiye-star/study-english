import { useCallback, useEffect, useState } from "react";
import type { ApiClient } from "~/api/client";
import { fetchRoomAgents, type RoomAgentsInfo } from "./room-agents-api";

/** 房间智能体名单:agentIds 变化(room_update)或 refresh() 时重新读取;取不到就保持 null(界面不显示智能体信息)。 */
export function useRoomAgents(api: ApiClient, roomId: string, agentIds: readonly string[], enabled: boolean) {
  const key = agentIds.join(",");
  const [info, setInfo] = useState<RoomAgentsInfo | null>(null);
  const [nonce, setNonce] = useState(0);
  useEffect(() => {
    if (!enabled || !roomId) return;
    const ctrl = new AbortController();
    fetchRoomAgents(api, roomId, ctrl.signal).then(setInfo, (): void => undefined);
    return () => ctrl.abort();
  }, [api, roomId, key, enabled, nonce]);
  const refresh = useCallback(() => setNonce((n) => n + 1), []);
  return { info, refresh };
}
