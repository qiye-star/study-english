import camelcaseKeys from "camelcase-keys";

/** 与 server/app/rooms/protocol.py 逐字对应(protocol.test.ts 直接读取服务端文件核对)。 */
export const ROOM_CLOSE = { NORMAL: 1000, RESTART: 1012, UNAUTHORIZED: 4001, DISABLED: 4003, NOT_FOUND: 4004, KICKED: 4010, BUSY: 4029, PROTOCOL: 4400 } as const;
export const ROOM_LIMITS = { clientText: 8192, sayRaw: 2000, assistText: 500, id: 64, text: 500 } as const;
export const ROOM_SERVER_EVENT_TYPES = ["welcome", "message", "ack", "presence", "ai_typing", "ai_failed", "assist_reply", "assist_failed", "room_update", "notice", "error", "closed", "pong", "message_hidden",
  "activity", "reaction", "voice_update", "join_request", "join_request_closed", "reopened",
  "agent_step", "agent_thought", "agent_tutor"] as const;
/** 联机智能体(plan 2026-10-12-agents-rooms):房主最多选 max 个角色;带练每人 tutorTurnSeconds 秒作答。 */
export const ROOM_AGENTS = { max: 2, tutorTurnSeconds: 60 } as const;
/** 协议 v2(spec 2026-10-10 §9,R2-16):只做加法;hello 带 v,welcome.protocol 给出服务端版本。 */
export const ROOM_PROTOCOL_VERSION = 2;
/** 表情回应 key:小写、无下划线(camelcase-keys 会改写对象键,所以线上用 [{key, user_ids}] 列表,R2-15)。与服务端同序。 */
export const REACTION_KEYS = ["like", "love", "haha", "wow", "clap", "thanks"] as const;
export type ReactionKey = (typeof REACTION_KEYS)[number];
export const REACTION_GLYPHS: Record<ReactionKey, string> = { like: "👍", love: "❤️", haha: "😂", wow: "😮", clap: "👏", thanks: "🙏" };
export type ActivityState = "typing" | "recording" | "idle";
const TERMINAL = new Set<number>([ROOM_CLOSE.DISABLED, ROOM_CLOSE.NOT_FOUND, ROOM_CLOSE.KICKED, ROOM_CLOSE.PROTOCOL]);

export interface RoomSender { kind: "user" | "ai" | "system"; id: number | null; name: string | null }
export interface AssistMeta { replyZh: string; suggestions: { en: string; noteZh: string }[]; glossary: { src: string; en: string }[] }
/** 语音消息的共享状态(转写一次、翻译懒生成,全房共享;spec §4)。audio=false:音频已被管理员清理。 */
export interface VoiceInfo {
  durationMs: number; status: "pending" | "done" | "empty" | "failed"; transcript: string | null; lang: "en" | "zh" | null;
  translation: string | null; translationStatus: "pending" | "done" | "failed" | null; attempts: number; audio: boolean;
}
/** 引用快照(服务端存于 meta.quote 并提升为 quote;被引用消息被隐藏后 text 为空串)。 */
export interface QuoteInfo { seq: number; name: string | null; kind: string; text: string }
export interface ReactionInfo { key: ReactionKey; userIds: number[] }
export interface JoinRequestInfo {
  id: string; roomId: string; roomName: string; userId: number; name: string;
  status: "pending" | "approved" | "denied" | "expired" | "cancelled"; createdAt: string;
}
export interface RoomMessage {
  seq: number; id: string; lane: "public" | "private"; kind: "text" | "voice" | "ai_answer" | "system" | "assist_request" | "assist_reply" | "agent_trace";
  sender: RoomSender; text: string; assisted: boolean; replyTo: number | null; aiStatus: "pending" | "done" | "failed" | null;
  meta: Record<string, unknown> | null; createdAt: string;
  /** 管理员隐藏:行保留(R-6),正文、meta、引用、语音、回应都不再下发 */
  hidden?: boolean;
  /** v2;v1 服务端不下发时由 reducer 补成 null / null / [] */
  quote: QuoteInfo | null; voice: VoiceInfo | null; reactions: ReactionInfo[];
}
export interface RoomInfo {
  id: string; code: string | null; topic: string; status: "open" | "closed"; locked: boolean; aiPublic: boolean; /** 管理员禁用了本房 AI */ aiMuted?: boolean; /** null = 房主已删除(房间只读保留) */ ownerId: number | null;
  myRole: "owner" | "member" | null; memberCount: number; onlineCount: number; createdAt: string; closedAt: string | null;
  /** 结束原因(owner / idle / expired / admin);开放房间为 null。管理员关闭的房间房主不能自己重新开启 */
  closeReason?: string | null;
  /** v2 的 7 项设置(topic 仍下发,= name) */
  name: string; scenario: string; level: string; joinMode: "code" | "approval"; maxMembers: number; allowVoice: boolean;
  /** 房主选的智能体角色 id(最多 ROOM_AGENTS.max 个;名字等经 GET /api/rooms/{id}/agents 读取)。旧服务端没有时为 undefined */
  agentIds?: string[];
}
export interface RoomMemberInfo { userId: number; name: string; role: "owner" | "member"; online: boolean }
/** 智能体过程的一步(只发给提问者;spec §4.4 的 step 形状,camelCase)。private = 读了个人数据,界面标「仅你可见」。 */
export interface AgentStepWire {
  id: string; group: "context" | "tool"; key: string; status: "run" | "done" | "fail" | "skip"; labelKey: string;
  params?: Record<string, unknown> | null; ms?: number | null; private: boolean;
}
/** summary = 模型自述(界面注明「非原始推理」),reasoning = 推理模型返回的文字。 */
export interface AgentThoughtWire { source: "summary" | "reasoning"; text: string }
/** 带练的公共状态(rooms.agent_tutor 的对外视图)。remainingMs 是服务端发出这一帧时的剩余毫秒,倒计时据此计算。 */
export interface RoomTutorInfo {
  personaId: string; personaName: string; phase: "generating" | "await_answer" | "paused"; stepIndex: number; stepsTotal: number;
  currentUserId: number | null; currentName: string | null; deadlineAt: string | null; remainingMs: number | null; startedBy: number;
  pausedReason: "restart" | "quota" | "upstream" | "ai_off" | "agent_off" | "state" | null;
}
export type RoomEvent =
  | { type: "welcome"; room: RoomInfo; me: { userId: number; role: "owner" | "member" }; members: RoomMemberInfo[]; lastSeq: number; truncated: boolean; assistHistory: RoomMessage[];
      protocol: number; reactions: { seq: number; key: ReactionKey; userIds: number[] }[]; joinRequests: JoinRequestInfo[] }
  | { type: "message"; message: RoomMessage }
  | { type: "ack"; clientId: string; seq: number }
  | { type: "presence"; members: RoomMemberInfo[] }
  | { type: "ai_typing"; replyTo: number }
  | { type: "ai_failed"; replyTo: number; code: "upstream" | "quota" | "restart" }
  | { type: "assist_reply"; requestId: string; message: RoomMessage }
  | { type: "assist_failed"; requestId: string; code: "upstream" | "quota" | "format" }
  | { type: "room_update"; room: RoomInfo }
  | { type: "notice"; code: "ai_off" | "ai_busy" | "ai_quota" | "voice_off" | "voice_quota" | "translate_quota" | "retry_limit" | "agent_off" }
  | { type: "error"; code: "rate_limited" | "empty" | "bad_assist" | "bad_reply" | "bad_seq" }
  | { type: "closed"; reason: string }
  | { type: "pong" }
  | { type: "message_hidden"; seq: number }
  | { type: "activity"; userId: number; state: ActivityState }
  | { type: "reaction"; seq: number; key: ReactionKey; userIds: number[] }
  | { type: "voice_update"; seq: number; voice: VoiceInfo }
  | { type: "join_request"; request: JoinRequestInfo }
  | { type: "join_request_closed"; id: string; status: JoinRequestInfo["status"] }
  | { type: "reopened"; room: RoomInfo }
  | { type: "agent_step"; turnId: string; replyTo: number; step: AgentStepWire }
  | { type: "agent_thought"; turnId: string; replyTo: number; thought: AgentThoughtWire }
  | { type: "agent_tutor"; tutor: RoomTutorInfo | null };

const TYPES = new Set<string>(ROOM_SERVER_EVENT_TYPES);

/** 解析服务端帧;不是 JSON 对象或类型未知时返回 null(不抛错、不记录内容)。 */
export function parseRoomEvent(text: string): RoomEvent | null {
  try {
    const raw = JSON.parse(text) as unknown;
    if (!raw || typeof raw !== "object" || Array.isArray(raw) || !TYPES.has((raw as { type?: string }).type ?? "")) return null;
    return camelcaseKeys(raw as Record<string, unknown>, { deep: true }) as unknown as RoomEvent;
  } catch {
    return null;
  }
}

const clip = (s: string, n: number) => Array.from(s.trim()).slice(0, n).join("").trim();
export const encodeHello = (lastSeq: number) => JSON.stringify({ type: "hello", last_seq: Math.max(0, Math.floor(lastSeq)), v: ROOM_PROTOCOL_VERSION });
export const encodePing = () => JSON.stringify({ type: "ping" });

const validSeq = (seq: number | null | undefined): seq is number => typeof seq === "number" && Number.isInteger(seq) && seq >= 1 && seq <= 2_147_483_647;

export function encodeSay(p: { clientId: string; text: string; assistId?: string | null; replyTo?: number | null }): string | null {
  const text = clip(p.text, ROOM_LIMITS.sayRaw);
  return text ? JSON.stringify({ type: "say", client_id: p.clientId.slice(0, ROOM_LIMITS.id), text, assist_id: p.assistId ?? null,
    reply_to: validSeq(p.replyTo) ? p.replyTo : null }) : null;
}

export const encodeTyping = (state: ActivityState) => JSON.stringify({ type: "typing", state });
export const encodeReact = (seq: number, key: ReactionKey, on: boolean) => JSON.stringify({ type: "react", seq, key, on });
export const encodeVoiceTranslate = (seq: number) => JSON.stringify({ type: "voice_translate", seq });
export const encodeVoiceRetry = (seq: number) => JSON.stringify({ type: "voice_retry", seq });

export function encodeAssist(p: { requestId: string; text: string }): string | null {
  const text = clip(p.text, ROOM_LIMITS.assistText);
  return text ? JSON.stringify({ type: "assist", request_id: p.requestId.slice(0, ROOM_LIMITS.id), text }) : null;
}

const MENTION = /^@(?:ai|助手)(?=$|[\s:：,，])[\s:：,，]*/i;
/** 与服务端 rules.mention 相同(共用 server/tests/fixtures/room_mentions.json);服务端是权威,这里只用来高亮。 */
export function mentionsAi(text: string): { ai: boolean; question: string } {
  const stripped = text.trim();
  const m = MENTION.exec(stripped);
  if (!m) return { ai: false, question: "" };
  const question = stripped.slice(m[0].length).trim();
  return question ? { ai: true, question } : { ai: false, question: "" };
}

export const isTerminalClose = (code: number) => TERMINAL.has(code);

/** 票据是机密:只放进 URL,不记录、不放进错误信息。 */
export function roomWsUrl(ticket: string, loc: { protocol: string; host: string }): string {
  return `${loc.protocol === "https:" ? "wss:" : "ws:"}//${loc.host}/api/rooms/ws?ticket=${encodeURIComponent(ticket)}`;
}
