import camelcaseKeys from "camelcase-keys";

/** 与 server/app/rooms/protocol.py 逐字对应(protocol.test.ts 直接读取服务端文件核对)。 */
export const ROOM_CLOSE = { NORMAL: 1000, RESTART: 1012, UNAUTHORIZED: 4001, DISABLED: 4003, NOT_FOUND: 4004, KICKED: 4010, BUSY: 4029, PROTOCOL: 4400 } as const;
export const ROOM_LIMITS = { clientText: 8192, sayRaw: 2000, assistText: 500, id: 64, text: 500 } as const;
export const ROOM_SERVER_EVENT_TYPES = ["welcome", "message", "ack", "presence", "ai_typing", "ai_failed", "assist_reply", "assist_failed", "room_update", "notice", "error", "closed", "pong", "message_hidden"] as const;
const TERMINAL = new Set<number>([ROOM_CLOSE.DISABLED, ROOM_CLOSE.NOT_FOUND, ROOM_CLOSE.KICKED, ROOM_CLOSE.PROTOCOL]);

export interface RoomSender { kind: "user" | "ai" | "system"; id: number | null; name: string | null }
export interface AssistMeta { replyZh: string; suggestions: { en: string; noteZh: string }[]; glossary: { src: string; en: string }[] }
export interface RoomMessage {
  seq: number; id: string; lane: "public" | "private"; kind: "text" | "ai_answer" | "system" | "assist_request" | "assist_reply";
  sender: RoomSender; text: string; assisted: boolean; replyTo: number | null; aiStatus: "pending" | "done" | "failed" | null;
  meta: Record<string, unknown> | null; createdAt: string;
  /** 管理员隐藏:行保留(R-6),正文与 meta 不再下发 */
  hidden?: boolean;
}
export interface RoomInfo {
  id: string; code: string | null; topic: string; status: "open" | "closed"; locked: boolean; aiPublic: boolean; /** 管理员禁用了本房 AI */ aiMuted?: boolean; /** null = 房主已删除(房间只读保留) */ ownerId: number | null;
  myRole: "owner" | "member" | null; memberCount: number; onlineCount: number; createdAt: string; closedAt: string | null;
}
export interface RoomMemberInfo { userId: number; name: string; role: "owner" | "member"; online: boolean }
export type RoomEvent =
  | { type: "welcome"; room: RoomInfo; me: { userId: number; role: "owner" | "member" }; members: RoomMemberInfo[]; lastSeq: number; truncated: boolean; assistHistory: RoomMessage[] }
  | { type: "message"; message: RoomMessage }
  | { type: "ack"; clientId: string; seq: number }
  | { type: "presence"; members: RoomMemberInfo[] }
  | { type: "ai_typing"; replyTo: number }
  | { type: "ai_failed"; replyTo: number; code: "upstream" | "quota" | "restart" }
  | { type: "assist_reply"; requestId: string; message: RoomMessage }
  | { type: "assist_failed"; requestId: string; code: "upstream" | "quota" | "format" }
  | { type: "room_update"; room: RoomInfo }
  | { type: "notice"; code: "ai_off" | "ai_busy" | "ai_quota" }
  | { type: "error"; code: "rate_limited" | "empty" | "bad_assist" }
  | { type: "closed"; reason: string }
  | { type: "pong" }
  | { type: "message_hidden"; seq: number };

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
export const encodeHello = (lastSeq: number) => JSON.stringify({ type: "hello", last_seq: Math.max(0, Math.floor(lastSeq)) });
export const encodePing = () => JSON.stringify({ type: "ping" });

export function encodeSay(p: { clientId: string; text: string; assistId?: string | null }): string | null {
  const text = clip(p.text, ROOM_LIMITS.sayRaw);
  return text ? JSON.stringify({ type: "say", client_id: p.clientId.slice(0, ROOM_LIMITS.id), text, assist_id: p.assistId ?? null }) : null;
}

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
