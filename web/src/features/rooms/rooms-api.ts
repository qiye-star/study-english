import type { ApiClient } from "~/api/client";
import type { RoomInfo, RoomMemberInfo, RoomMessage } from "./protocol";

export interface RoomsConfig { enabled: boolean; aiAvailable: boolean; maxMembers: number; maxText: number }

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
export async function myRooms(api: ApiClient, signal?: AbortSignal): Promise<RoomInfo[]> {
  return (await api.request<{ rooms: RoomInfo[] }>("GET", "/api/rooms/mine", { signal })).rooms;
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
