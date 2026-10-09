import { useCallback, useEffect, useReducer, useRef } from "react";
import { ApiError } from "~/api/client";
import { useAuth } from "~/auth/auth-context";
import {
  encodeAssist, encodeReact, encodeSay, encodeTyping, encodeVoiceRetry, encodeVoiceTranslate, roomWsUrl,
  type ActivityState, type ReactionKey, type RoomInfo, type RoomMessage,
} from "./protocol";
import { initialRoomState, roomReducer } from "./room-state";
import { RoomSocket } from "./room-socket";
import { getRoom, HISTORY_PAGE, LATEST_SEQ, roomHistory, roomTicket } from "./rooms-api";

/** 语音状态还会变的消息(转写或翻译进行中)的 seq。 */
function waitingVoiceSeqs(messages: RoomMessage[]): number[] {
  return messages.filter((m) => !m.hidden && (m.voice?.status === "pending" || m.voice?.translationStatus === "pending")).map((m) => m.seq);
}

const newId = () => (globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random()}`).slice(0, 64);
/** 多久清一次过期的「正在输入」(ACTIVITY_TTL_MS 之前的)。 */
const ACTIVITY_SWEEP_MS = 2000;

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
    // 卸载(含 StrictMode 的试卸载)后旧连接的回调一律忽略:否则 close() 发出的「closed」会把新连接的状态锁死在终态
    let disposed = false;
    const socket = new RoomSocket({
      getTicket: () => roomTicket(api, roomId),
      url: (ticket) => roomWsUrl(ticket, window.location),
      lastSeq: () => stateRef.current.lastSeq,
      onEvent: (event) => {
        if (disposed) return;
        // 补发只给 last_seq 之后的消息:列表里还在「转文字中 / 翻译中」的语音,其 voice_update 可能在断线期间错过了(review M1)
        const stalled = event.type === "welcome" && !event.truncated ? waitingVoiceSeqs(stateRef.current.messages) : [];
        dispatch({ type: "event", event, at: Date.now() });
        if (stalled.length) {
          roomHistory(api, roomId, Math.max(...stalled) + 1).then(
            (messages) => { if (!disposed) dispatch({ type: "voice_sync", messages }); },
            (): void => undefined, // 取不到就等下一次 voice_update
          );
        }
        // 断线前没拿到 ack 的消息:用原 client_id 重发,服务端 5 分钟内去重并回原来的 ack(spec §5.7)
        if (event.type === "welcome") {
          for (const p of stateRef.current.pending) {
            const frame = p.seq === null ? encodeSay(p) : null;
            if (frame) socket.send(frame);
          }
        }
      },
      onStatus: (status, reason) => { if (!disposed) dispatch({ type: "status", status, reason }); },
      // 403 = 被移出房间(Removed from room);404 = 不存在或已结束
      isTerminalTicketError: (err) => err instanceof ApiError && (err.status === 403 ? "kicked" : err.status === 404),
    });
    socketRef.current = socket;
    socket.connect();
    const onVisible = () => { if (document.visibilityState === "visible") socket.reconnectNow(); };
    document.addEventListener("visibilitychange", onVisible);
    const sweep = window.setInterval(() => dispatch({ type: "activity_expire", now: Date.now() }), ACTIVITY_SWEEP_MS);
    return () => {
      disposed = true;
      window.clearInterval(sweep);
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

  const say = useCallback((text: string, assistId: string | null = null, replyTo: number | null = null) => {
    const clientId = newId();
    const frame = encodeSay({ clientId, text, assistId, replyTo });
    if (!frame || !socketRef.current?.send(frame)) return false;
    dispatch({ type: "say", pending: { clientId, text: text.trim(), assistId, seq: null, replyTo } });
    return true;
  }, []);

  /** 以下 v2 发送函数:没有连接(重连中、已结束)时返回 false,不排队。 */
  const send = (frame: string) => socketRef.current?.send(frame) ?? false;
  const typing = useCallback((s: ActivityState) => send(encodeTyping(s)), []);
  const react = useCallback((seq: number, key: ReactionKey, on: boolean) => send(encodeReact(seq, key, on)), []);
  const translateVoice = useCallback((seq: number) => send(encodeVoiceTranslate(seq)), []);
  const retryVoice = useCallback((seq: number) => send(encodeVoiceRetry(seq)), []);
  /** HTTP 上传的语音消息({seq, message}):立即放进列表,广播随后到达时按 seq 去重;不推进补发游标(review M2)。 */
  const addMessage = useCallback((message: RoomMessage) => dispatch({ type: "local_message", message }), []);

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

  return { state, say, ask, loadEarlier, applyRoom, dismiss, typing, react, translateVoice, retryVoice, addMessage };
}
