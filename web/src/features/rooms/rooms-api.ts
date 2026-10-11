import type { ApiClient } from "~/api/client";
import type { ReactionKey, RoomInfo, RoomMemberInfo, RoomMessage } from "./protocol";

export interface RoomsConfig {
  enabled: boolean; aiAvailable: boolean; maxMembers: number; maxText: number;
  /** v2(spec §8):情景池(brief 不下发)、水平、表单默认人数与名称上限、语音与小结是否可用、表情回应 key */
  scenarios: { key: string; titleZh: string; titleEn: string }[]; levels: string[]; defaultMaxMembers: number; nameMax: number;
  voiceAvailable: boolean; maxVoiceMs: number; summaryAvailable: boolean; reactions: ReactionKey[];
}

/** 服务端错误原文 → i18n key(translateServerError 的 extra 表)。 */
export const ROOMS_SERVER_ERRORS: Record<string, string> = {
  "Room not found": "web.rooms.errors.notFound",
  "Room is locked": "web.rooms.errors.locked",
  "Room is full": "web.rooms.errors.full",
  "Removed from room": "web.rooms.errors.kicked",
  "Too many rooms": "web.rooms.errors.tooMany",
  "Room capacity reached": "web.rooms.errors.capacity",
  "Only the owner can do that": "web.rooms.errors.ownerOnly",
  "Rooms are disabled": "web.rooms.disabled",
  "Room is not closed": "web.rooms.errors.notClosed",
  "Closed by an administrator": "web.rooms.errors.adminClosed",
  // admin-only / unreachable-from-the-UI errors fall back to the generic text
  "Room has no owner": "web.rooms.errors.generic",
  "Invalid cursor": "web.rooms.errors.generic",
};

/** 历史页大小(与服务端 GET /messages 的默认 limit 一致)。 */
export const HISTORY_PAGE = 50;
/** 「最新之前」的 before_seq:seq 是 32 位整数列,用 int32 上限而不是 MAX_SAFE_INTEGER(Postgres 绑定参数会溢出)。 */
export const LATEST_SEQ = 2_147_483_647;

const FULLWIDTH = /[０-９]/g;
/** 与服务端 codes.normalize_code 一致:全角转半角、去空白,`^[1-9]\d{5}$` 才有效。 */
export function normalizeCode(raw: string): string | null {
  const text = raw.replace(FULLWIDTH, (d) => String.fromCharCode(d.charCodeAt(0) - 0xfee0)).replace(/\s+/g, "");
  return /^[1-9]\d{5}$/.test(text) ? text : null;
}

const rid = (id: string) => `/api/rooms/${encodeURIComponent(id)}`;

export function fetchRoomsConfig(api: ApiClient, signal?: AbortSignal): Promise<RoomsConfig> {
  return api.request<RoomsConfig>("GET", "/api/rooms/config", { signal });
}
export async function createRoom(api: ApiClient, topic: string): Promise<RoomInfo> {
  return (await api.request<{ room: RoomInfo }>("POST", "/api/rooms", { json: { topic } })).room;
}
export async function joinRoom(api: ApiClient, code: string): Promise<RoomInfo> {
  return (await api.request<{ room: RoomInfo }>("POST", "/api/rooms/join", { json: { code } })).room;
}
/** 「我的房间」一行:已结束的房间带学习小结状态(spec §6.1 入口;open 为 null,没有小结记录为 "none")。 */
export type MySummaryStatus = "none" | "pending" | "done" | "failed" | "skipped";
export type MyRoom = RoomInfo & { summaryStatus?: MySummaryStatus | null };
/** 已结束页每次取多少(服务端 limit 上限 50)。 */
export const ENDED_PAGE = 20;
export interface EndedPage { rooms: MyRoom[]; nextCursor: string | null }

/** 大厅概览:进行中的房间 + 已结束房间总数(入口「已结束的房间(N)」)。 */
export async function myRoomsOverview(api: ApiClient, signal?: AbortSignal): Promise<{ rooms: MyRoom[]; endedCount: number }> {
  const res = await api.request<{ rooms: MyRoom[]; endedCount?: number }>("GET", "/api/rooms/mine", { signal });
  return { rooms: res.rooms, endedCount: res.endedCount ?? 0 };
}
export async function myRooms(api: ApiClient, signal?: AbortSignal): Promise<MyRoom[]> {
  return (await myRoomsOverview(api, signal)).rooms;
}
/** 已结束的房间(全部,按结束时间倒序);cursor 是上一页的 nextCursor,首页传 null。 */
export function endedRooms(api: ApiClient, cursor: string | null, signal?: AbortSignal): Promise<EndedPage> {
  return api.request<EndedPage>("GET", "/api/rooms/ended", { query: cursor ? { limit: ENDED_PAGE, cursor } : { limit: ENDED_PAGE }, signal });
}
/** 房主重新开启已结束的房间:返回新的(开放)房间,带新房间号。 */
export async function reopenRoom(api: ApiClient, id: string): Promise<RoomInfo> {
  return (await api.request<{ room: RoomInfo }>("POST", `${rid(id)}/reopen`)).room;
}
export function getRoom(api: ApiClient, id: string, signal?: AbortSignal): Promise<{ room: RoomInfo; members: RoomMemberInfo[] }> {
  return api.request("GET", rid(id), { signal });
}
/** seq < beforeSeq 的最多 50 条(公共 + 本人私聊),按 seq 升序。 */
export async function roomHistory(api: ApiClient, id: string, beforeSeq: number, signal?: AbortSignal): Promise<RoomMessage[]> {
  return (await api.request<{ messages: RoomMessage[] }>("GET", `${rid(id)}/messages`, { query: { before_seq: beforeSeq, limit: HISTORY_PAGE }, signal })).messages;
}
/** 一次性票据(机密):只交给 roomWsUrl,不记录。 */
export async function roomTicket(api: ApiClient, id: string): Promise<string> {
  return (await api.request<{ ticket: string }>("POST", `${rid(id)}/ticket`)).ticket;
}
export async function updateRoom(api: ApiClient, id: string, patch: { topic?: string; locked?: boolean; aiPublic?: boolean }): Promise<RoomInfo> {
  const json: Record<string, unknown> = {};
  if (patch.topic !== undefined) json.topic = patch.topic;
  if (patch.locked !== undefined) json.locked = patch.locked;
  if (patch.aiPublic !== undefined) json.ai_public = patch.aiPublic;
  return (await api.request<{ room: RoomInfo }>("PATCH", rid(id), { json })).room;
}
export async function kickMember(api: ApiClient, id: string, userId: number): Promise<void> {
  await api.request("POST", `${rid(id)}/kick`, { json: { user_id: userId } });
}
export async function leaveRoom(api: ApiClient, id: string): Promise<void> {
  await api.request("POST", `${rid(id)}/leave`);
}
export async function closeRoom(api: ApiClient, id: string): Promise<RoomInfo> {
  return (await api.request<{ room: RoomInfo }>("POST", `${rid(id)}/close`)).room;
}
export async function reportMessage(api: ApiClient, id: string, messageId: string, reason: "spam" | "abuse" | "other"): Promise<void> {
  await api.request("POST", `${rid(id)}/messages/${encodeURIComponent(messageId)}/report`, { json: { reason } });
}
