import type { ActivityState, JoinRequestInfo, ReactionInfo, RoomEvent, RoomInfo, RoomMemberInfo, RoomMessage } from "./protocol";

/** 已发出、还没在列表里看到的消息。seq 来自 ack:消息本身(广播/补发)到达前气泡一直保留,断线重连时据 seq 为空判断要重发。
 *  replyTo:引用回复的 seq(v2;缺省 = null),重发时一并带上。 */
export interface PendingSay { clientId: string; text: string; assistId: string | null; seq: number | null; replyTo?: number | null }
/** 「正在输入 / 正在说话」超过这么久没刷新就消失(spec §6.5)。 */
export const ACTIVITY_TTL_MS = 6000;
/** welcome.reactions 覆盖的最近 seq 数(服务端 RoomStore.recent_reactions 默认 200)。 */
export const WELCOME_REACTION_SPAN = 200;
export interface AssistEntry { requestId: string | null; request: string; reply: RoomMessage | null; status: "waiting" | "done" | "failed"; error: string | null }
export type RoomStatus = "connecting" | "live" | "reconnecting" | "closed";
export interface RoomState {
  status: RoomStatus; closeReason: string | null; room: RoomInfo | null; me: { userId: number; role: "owner" | "member" } | null;
  members: RoomMemberInfo[]; messages: RoomMessage[]; lastSeq: number; truncated: boolean; pending: PendingSay[];
  aiTyping: number[]; assist: AssistEntry[]; notice: string | null; error: string | null;
  /** welcome 时房间的最新 seq:更大的才是实时到达的消息(其余是补发) */
  liveFrom: number;
  /** 最近一条实时到达的、别人发的消息:只给读屏播报用 */
  announce: RoomMessage | null;
  /** 其他成员的「正在输入 / 正在说话」:userId → 状态与收到的时间(毫秒);idle 即删除 */
  activity: Record<number, { state: ActivityState; at: number }>;
  /** 房主才有:待处理的加入请求 */
  joinRequests: JoinRequestInfo[];
  /** 服务端协议版本(welcome.protocol;v1 服务端没有时为 1) */
  protocol: number;
  /** 收到 reopened 事件的次数:use-room 据此重置并重连(轮询或房主本人触发时也走这条) */
  reopenSignal: number;
}
export type RoomAction =
  | { type: "status"; status: RoomStatus; reason?: string }
  /** at:收到事件的时间(毫秒,注入以便测试;activity 用它) */
  | { type: "event"; event: RoomEvent; at?: number }
  /** 清除 ACTIVITY_TTL_MS 之前的活动 */
  | { type: "activity_expire"; now: number }
  | { type: "say"; pending: PendingSay }
  /** 自己经 HTTP 发出的消息(语音上传的响应):放进列表,但不推进 lastSeq(更早的别人的消息可能还在 WS 路上,review M2) */
  | { type: "local_message"; message: RoomMessage }
  /** 重连后用 HTTP 取回的消息:只更新列表里已有消息的语音状态(断线期间错过的 voice_update,review M1) */
  | { type: "voice_sync"; messages: RoomMessage[] }
  | { type: "assist"; requestId: string; text: string }
  /** 更早的一页;more 给出时据此更新「还有更早的」。 */
  | { type: "prepend"; messages: RoomMessage[]; more?: boolean }
  /** 已结束的房间:不连 WebSocket,用 HTTP 读到的房间、成员与最新一页历史只读展示。 */
  | { type: "history"; room: RoomInfo; members: RoomMemberInfo[]; meId: number | null; messages: RoomMessage[]; more: boolean }
  /** 重新开启后重连:回到初始状态(保留 reopenSignal,否则会再次触发) */
  | { type: "reset" }
  | { type: "dismiss" };

export const initialRoomState = (): RoomState => ({
  status: "connecting", closeReason: null, room: null, me: null, members: [], messages: [], lastSeq: 0, truncated: false,
  pending: [], aiTyping: [], assist: [], notice: null, error: null, liveFrom: 0, announce: null,
  activity: {}, joinRequests: [], protocol: 1, reopenSignal: 0,
});

/** v1 服务端(或旧样例)不带 v2 字段:补成 null / null / []。 */
export function normalizeMessage(m: RoomMessage): RoomMessage {
  return m.quote !== undefined && m.voice !== undefined && Array.isArray(m.reactions)
    ? m : { ...m, quote: m.quote ?? null, voice: m.voice ?? null, reactions: Array.isArray(m.reactions) ? m.reactions : [] };
}

/** 公共消息按 seq 去重、升序;私聊消息(助手)从不进入公共列表。 */
function merge(list: RoomMessage[], incoming: RoomMessage[]): RoomMessage[] {
  const bySeq = new Map(list.map((m) => [m.seq, m]));
  for (const m of incoming) if (m.lane === "public") bySeq.set(m.seq, normalizeMessage(m));
  return [...bySeq.values()].sort((a, b) => a.seq - b.seq);
}

const withSeq = (messages: RoomMessage[], seq: number, f: (m: RoomMessage) => RoomMessage) => {
  const i = messages.findIndex((m) => m.seq === seq);
  return i < 0 ? messages : messages.map((m, j) => (j === i ? f(m) : m));
};

/** 某条消息某个表情的完整名单(幂等):空名单 = 删除这一片;顺序按 REACTION_KEYS 由服务端给出,新出现的 key 追加在后。 */
function setReaction(list: ReactionInfo[], key: ReactionInfo["key"], userIds: number[]): ReactionInfo[] {
  if (!userIds.length) return list.filter((r) => r.key !== key);
  return list.some((r) => r.key === key) ? list.map((r) => (r.key === key ? { key, userIds } : r)) : [...list, { key, userIds }];
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

function onEvent(s: RoomState, e: RoomEvent, at: number): RoomState {
  switch (e.type) {
    case "welcome": {
      // 补发被截断(只给最新一页):旧列表与新页之间会有空洞,清空后从最新一页重新开始,「加载更早」才能补齐。
      // 「AI 正在输入」不随补发重放:清空,补发里的 ai_answer / ai_status 会给出最终状态。
      // v2:最近 200 个 seq 上的回应以 welcome.reactions 为准(断线期间的变化);活动不补发,清空。
      const kept = e.truncated ? [] : s.messages;
      const recent = e.reactions ?? [];
      const floor = e.lastSeq - WELCOME_REACTION_SPAN;
      const messages = recent.length || kept.some((m) => m.seq > floor && m.reactions?.length)
        ? kept.map((m) => (m.seq > floor
          ? { ...m, reactions: recent.filter((r) => r.seq === m.seq).map((r) => ({ key: r.key, userIds: r.userIds })) } : m))
        : kept;
      return { ...s, status: "live", room: e.room, me: e.me, members: e.members, truncated: e.truncated,
        messages, aiTyping: [], liveFrom: e.lastSeq,
        assist: s.assist.length ? s.assist : historyEntries(e.assistHistory),
        protocol: e.protocol ?? 1, joinRequests: e.joinRequests ?? [], activity: {} };
    }
    case "message": {
      const m = e.message;
      let messages = merge(s.messages, [m]);
      let aiTyping = s.aiTyping;
      if (m.kind === "ai_answer" && m.replyTo !== null) {
        aiTyping = aiTyping.filter((x) => x !== m.replyTo);
        messages = messages.map((x) => (x.seq === m.replyTo ? { ...x, aiStatus: "done" as const } : x));
      }
      const pending = s.pending.some((p) => p.seq === m.seq) ? s.pending.filter((p) => p.seq !== m.seq) : s.pending;
      const live = m.lane === "public" && m.seq > s.liveFrom && m.kind !== "system" && !(m.sender.kind === "user" && m.sender.id === s.me?.userId);
      return { ...s, messages, aiTyping, pending, announce: live ? m : s.announce, assist: pairReplayedReply(s.assist, m), lastSeq: Math.max(s.lastSeq, m.seq) };
    }
    case "ack":
      // 不推进 lastSeq:ack 先于消息本身(以及别人更早的消息)到达,这时断线会让补发跳过它们
      if (s.messages.some((m) => m.seq === e.seq)) return { ...s, pending: s.pending.filter((p) => p.clientId !== e.clientId) };
      return { ...s, pending: s.pending.map((p) => (p.clientId === e.clientId ? { ...p, seq: e.seq } : p)) };
    case "presence": {
      // 房主离开后服务端把房主交给最早的成员:成员表带 role,跟着更新自己的角色(review m8)
      const mine = s.me ? e.members.find((m) => m.userId === s.me!.userId) : undefined;
      const me = s.me && mine && mine.role !== s.me.role ? { ...s.me, role: mine.role } : s.me;
      return { ...s, members: e.members, me };
    }
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
    case "room_update": {
      // 广播的 room 不带个人角色(my_role=null):保留自己的;房主转移(ownerId 变成自己或别人)时据 ownerId 改写
      const meId = s.me?.userId;
      const own = meId !== undefined && e.room.ownerId !== undefined && e.room.ownerId !== null;
      const myRole = own ? (e.room.ownerId === meId ? "owner" : "member") : e.room.myRole ?? s.room?.myRole ?? null;
      const me = s.me && own ? { ...s.me, role: myRole as "owner" | "member" } : s.me;
      return { ...s, me, room: { ...e.room, myRole } };
    }
    case "notice":
      return { ...s, notice: e.code };
    case "error":
      return { ...s, error: e.code };
    case "closed":
      return { ...s, status: "closed", closeReason: e.reason, aiTyping: [] };
    case "pong":
      return s;
    case "message_hidden":
      // 管理员隐藏了一条消息:保留位置,清掉正文与 v2 附加内容;引用它的消息只清引用摘要
      return { ...s, messages: s.messages.map((x) => (x.seq === e.seq
        ? { ...x, hidden: true, text: "", meta: null, quote: null, voice: null, reactions: [] }
        : x.quote?.seq === e.seq ? { ...x, quote: { ...x.quote, text: "" } } : x)) };
    case "activity": {
      const { [e.userId]: _old, ...rest } = s.activity;
      return { ...s, activity: e.state === "idle" ? rest : { ...rest, [e.userId]: { state: e.state, at } } };
    }
    case "reaction":
      return { ...s, messages: withSeq(s.messages, e.seq, (m) => ({ ...m, reactions: setReaction(m.reactions ?? [], e.key, e.userIds) })) };
    case "voice_update":
      // 转写完成后正文 = 转写(服务端同样写回 room_messages.text,旧客户端也能看到文字)
      return { ...s, messages: withSeq(s.messages, e.seq, (m) => ({ ...m, voice: e.voice,
        text: e.voice.status === "done" ? e.voice.transcript ?? "" : m.text })) };
    case "join_request":
      return { ...s, joinRequests: [...s.joinRequests.filter((r) => r.id !== e.request.id), e.request] };
    case "join_request_closed":
      return { ...s, joinRequests: s.joinRequests.filter((r) => r.id !== e.id) };
    case "reopened":
      return { ...s, room: { ...e.room, myRole: e.room.myRole ?? s.room?.myRole ?? null }, reopenSignal: s.reopenSignal + 1 };
  }
}

export function roomReducer(s: RoomState, a: RoomAction): RoomState {
  switch (a.type) {
    case "status":
      return s.status === "closed" ? s : { ...s, status: a.status, closeReason: a.reason ?? s.closeReason };
    case "event":
      return onEvent(s, a.event, a.at ?? 0);
    case "activity_expire": {
      const entries = Object.entries(s.activity).filter(([, v]) => a.now - v.at <= ACTIVITY_TTL_MS);
      return entries.length === Object.keys(s.activity).length ? s : { ...s, activity: Object.fromEntries(entries) };
    }
    case "say":
      return { ...s, pending: [...s.pending, a.pending] };
    case "local_message":
      return { ...s, messages: merge(s.messages, [a.message]) };
    case "voice_sync": {
      const fresh = new Map(a.messages.filter((m) => m.voice).map((m) => [m.seq, m]));
      if (!fresh.size) return s;
      return { ...s, messages: s.messages.map((m) => {
        const f = fresh.get(m.seq);
        return f && m.voice && !m.hidden && f.id === m.id ? { ...m, voice: f.voice, text: f.text } : m;
      }) };
    }
    case "assist":
      return { ...s, assist: [...s.assist, { requestId: a.requestId, request: a.text, reply: null, status: "waiting", error: null }] };
    case "prepend":
      return { ...s, messages: merge(s.messages, a.messages), truncated: a.more ?? s.truncated };
    case "history": {
      const mine = a.members.find((m) => m.userId === a.meId);
      const role = a.room.myRole ?? mine?.role ?? "member";
      return { ...s, status: "closed", closeReason: "ended", room: a.room, members: a.members,
        me: a.meId === null ? null : { userId: a.meId, role }, messages: merge(s.messages, a.messages),
        lastSeq: maxSeq(s.lastSeq, a.messages), truncated: a.more, pending: [], aiTyping: [], activity: {} };
    }
    case "reset":
      return { ...initialRoomState(), reopenSignal: s.reopenSignal };
    case "dismiss":
      return { ...s, notice: null, error: null };
  }
}
