import { useCallback, useEffect, useReducer, useRef } from "react";
import { ApiError } from "~/api/client";
import { useAuth } from "~/auth/auth-context";
import { encodeAssist, encodeSay, roomWsUrl, type RoomInfo } from "./protocol";
import { initialRoomState, roomReducer } from "./room-state";
import { RoomSocket } from "./room-socket";
import { getRoom, HISTORY_PAGE, LATEST_SEQ, roomHistory, roomTicket } from "./rooms-api";

const newId = () => (globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random()}`).slice(0, 64);

/**
 * 一个房间的连接与状态:票据 → WebSocket(重连、补发、心跳由 RoomSocket 负责)。
 * 票据被拒(房间已结束)时改走 HTTP:读房间、成员与最新一页历史,只读展示(消息永久保存,已结束的房间仍可回看)。
 */
export function useRoom(roomId: string) {
  const { api, user } = useAuth();
  const [state, dispatch] = useReducer(roomReducer, undefined, initialRoomState);
  const stateRef = useRef(state);
  stateRef.current = state;
  const socketRef = useRef<RoomSocket | null>(null);
  const meId = user ? Number(user.id) : null;

  useEffect(() => {
    const socket = new RoomSocket({
      getTicket: () => roomTicket(api, roomId),
      url: (ticket) => roomWsUrl(ticket, window.location),
      lastSeq: () => stateRef.current.lastSeq,
      onEvent: (event) => dispatch({ type: "event", event }),
      onStatus: (status, reason) => dispatch({ type: "status", status, reason }),
      isTerminalTicketError: (err) => err instanceof ApiError && (err.status === 404 || err.status === 403),
    });
    socketRef.current = socket;
    socket.connect();
    const onVisible = () => { if (document.visibilityState === "visible") socket.reconnectNow(); };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      document.removeEventListener("visibilitychange", onVisible);
      socket.close();
      socketRef.current = null;
    };
  }, [api, roomId]);

  // 房间已结束(票据 404)且还没有任何内容:读历史只读展示;不是成员(或被移出)时保持「不存在或已结束」。
  const needsHistory = state.status === "closed" && state.closeReason === "not_found" && !state.room;
  useEffect(() => {
    if (!needsHistory) return;
    const ctrl = new AbortController();
    void (async () => {
      try {
        const [{ room, members }, messages] = await Promise.all([
          getRoom(api, roomId, ctrl.signal), roomHistory(api, roomId, LATEST_SEQ, ctrl.signal),
        ]);
        dispatch({ type: "history", room, members, meId, messages, more: messages.length >= HISTORY_PAGE });
      } catch {
        /* 保持关闭态的「不存在或已结束」提示 */
      }
    })();
    return () => ctrl.abort();
  }, [needsHistory, api, roomId, meId]);

  const say = useCallback((text: string, assistId: string | null = null) => {
    const clientId = newId();
    const frame = encodeSay({ clientId, text, assistId });
    if (!frame || !socketRef.current?.send(frame)) return false;
    dispatch({ type: "say", pending: { clientId, text: text.trim(), assistId } });
    return true;
  }, []);

  const ask = useCallback((text: string) => {
    const requestId = newId();
    const frame = encodeAssist({ requestId, text });
    if (!frame || !socketRef.current?.send(frame)) return null;
    dispatch({ type: "assist", requestId, text: text.trim() });
    return requestId;
  }, []);

  const loadEarlier = useCallback(async () => {
    const first = stateRef.current.messages[0];
    if (!first) return;
    const messages = await roomHistory(api, roomId, first.seq);
    dispatch({ type: "prepend", messages, more: messages.length >= HISTORY_PAGE });
  }, [api, roomId]);

  /** HTTP 操作(设置)返回的房间:立即生效,不必等 room_update 广播。 */
  const applyRoom = useCallback((room: RoomInfo) => dispatch({ type: "event", event: { type: "room_update", room } }), []);
  const dismiss = useCallback(() => dispatch({ type: "dismiss" }), []);

  return { state, say, ask, loadEarlier, applyRoom, dismiss };
}
