import type { RoomEvent, RoomInfo, RoomMemberInfo, RoomMessage } from "./protocol";

export interface PendingSay { clientId: string; text: string; assistId: string | null }
export interface AssistEntry { requestId: string | null; request: string; reply: RoomMessage | null; status: "waiting" | "done" | "failed"; error: string | null }
export type RoomStatus = "connecting" | "live" | "reconnecting" | "closed";
export interface RoomState {
  status: RoomStatus; closeReason: string | null; room: RoomInfo | null; me: { userId: number; role: "owner" | "member" } | null;
  members: RoomMemberInfo[]; messages: RoomMessage[]; lastSeq: number; truncated: boolean; pending: PendingSay[];
  aiTyping: number[]; assist: AssistEntry[]; notice: string | null; error: string | null;
}
export type RoomAction =
  | { type: "status"; status: RoomStatus; reason?: string }
  | { type: "event"; event: RoomEvent }
  | { type: "say"; pending: PendingSay }
  | { type: "assist"; requestId: string; text: string }
  /** 更早的一页;more 给出时据此更新「还有更早的」。 */
  | { type: "prepend"; messages: RoomMessage[]; more?: boolean }
  /** 已结束的房间:不连 WebSocket,用 HTTP 读到的房间、成员与最新一页历史只读展示。 */
  | { type: "history"; room: RoomInfo; members: RoomMemberInfo[]; meId: number | null; messages: RoomMessage[]; more: boolean }
  | { type: "dismiss" };

export const initialRoomState = (): RoomState => ({
  status: "connecting", closeReason: null, room: null, me: null, members: [], messages: [], lastSeq: 0, truncated: false,
  pending: [], aiTyping: [], assist: [], notice: null, error: null,
});

/** 公共消息按 seq 去重、升序;私聊消息(助手)从不进入公共列表。 */
function merge(list: RoomMessage[], incoming: RoomMessage[]): RoomMessage[] {
  const bySeq = new Map(list.map((m) => [m.seq, m]));
  for (const m of incoming) if (m.lane === "public") bySeq.set(m.seq, m);
  return [...bySeq.values()].sort((a, b) => a.seq - b.seq);
}

const maxSeq = (seq: number, messages: RoomMessage[]) => messages.reduce((n, m) => Math.max(n, m.seq), seq);

function historyEntries(history: RoomMessage[]): AssistEntry[] {
  const out: AssistEntry[] = [];
  for (const m of history) {
    if (m.kind === "assist_request") out.push({ requestId: null, request: m.text, reply: null, status: "done", error: null });
    else if (m.kind === "assist_reply") {
      const open = [...out].reverse().find((e) => !e.reply);
      if (open) open.reply = m;
      else out.push({ requestId: null, request: "", reply: m, status: "done", error: null });
    }
  }
  return out;
}

/** 断线期间到达的助手回复会在重连补发里以私聊 message 出现:配给最早一条仍在等待的请求。 */
function pairReplayedReply(assist: AssistEntry[], m: RoomMessage): AssistEntry[] {
  if (m.lane !== "private" || m.kind !== "assist_reply" || assist.some((a) => a.reply?.id === m.id)) return assist;
  const i = assist.findIndex((a) => a.status === "waiting");
  if (i < 0) return assist;
  return assist.map((a, j) => (j === i ? { ...a, reply: m, status: "done" as const } : a));
}

function onEvent(s: RoomState, e: RoomEvent): RoomState {
  switch (e.type) {
    case "welcome":
      return { ...s, status: "live", room: e.room, me: e.me, members: e.members, truncated: e.truncated,
        assist: s.assist.length ? s.assist : historyEntries(e.assistHistory) };
    case "message": {
      const m = e.message;
      let messages = merge(s.messages, [m]);
      let aiTyping = s.aiTyping;
      if (m.kind === "ai_answer" && m.replyTo !== null) {
        aiTyping = aiTyping.filter((x) => x !== m.replyTo);
        messages = messages.map((x) => (x.seq === m.replyTo ? { ...x, aiStatus: "done" as const } : x));
      }
      return { ...s, messages, aiTyping, assist: pairReplayedReply(s.assist, m), lastSeq: Math.max(s.lastSeq, m.seq) };
    }
    case "ack":
      return { ...s, pending: s.pending.filter((p) => p.clientId !== e.clientId), lastSeq: Math.max(s.lastSeq, e.seq) };
    case "presence":
      return { ...s, members: e.members };
    case "ai_typing":
      return s.aiTyping.includes(e.replyTo) ? s : { ...s, aiTyping: [...s.aiTyping, e.replyTo] };
    case "ai_failed":
      return { ...s, aiTyping: s.aiTyping.filter((x) => x !== e.replyTo),
        messages: s.messages.map((x) => (x.seq === e.replyTo ? { ...x, aiStatus: "failed" as const } : x)) };
    case "assist_reply":
      return { ...s, lastSeq: Math.max(s.lastSeq, e.message.seq),
        assist: s.assist.map((a) => (a.requestId === e.requestId ? { ...a, reply: e.message, status: "done" as const } : a)) };
    case "assist_failed":
      return { ...s, assist: s.assist.map((a) => (a.requestId === e.requestId ? { ...a, status: "failed" as const, error: e.code } : a)) };
    case "room_update":
      // 广播的 room 不带个人角色(my_role=null):保留自己的
      return { ...s, room: s.room ? { ...e.room, myRole: s.room.myRole } : e.room };
    case "notice":
      return { ...s, notice: e.code };
    case "error":
      return { ...s, error: e.code };
    case "closed":
      return { ...s, status: "closed", closeReason: e.reason, aiTyping: [] };
    case "pong":
      return s;
  }
}

export function roomReducer(s: RoomState, a: RoomAction): RoomState {
  switch (a.type) {
    case "status":
      return s.status === "closed" ? s : { ...s, status: a.status, closeReason: a.reason ?? s.closeReason };
    case "event":
      return onEvent(s, a.event);
    case "say":
      return { ...s, pending: [...s.pending, a.pending] };
    case "assist":
      return { ...s, assist: [...s.assist, { requestId: a.requestId, request: a.text, reply: null, status: "waiting", error: null }] };
    case "prepend":
      return { ...s, messages: merge(s.messages, a.messages), truncated: a.more ?? s.truncated };
    case "history": {
      const mine = a.members.find((m) => m.userId === a.meId);
      const role = a.room.myRole ?? mine?.role ?? "member";
      return { ...s, status: "closed", closeReason: "ended", room: a.room, members: a.members,
        me: a.meId === null ? null : { userId: a.meId, role }, messages: merge(s.messages, a.messages),
        lastSeq: maxSeq(s.lastSeq, a.messages), truncated: a.more, pending: [], aiTyping: [] };
    }
    case "dismiss":
      return { ...s, notice: null, error: null };
  }
}
