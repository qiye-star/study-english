import type { ApiClient } from "~/api/client";
import type { JoinRequestInfo, RoomInfo } from "../protocol";
import { ROOMS_SERVER_ERRORS } from "../rooms-api";

/** 房间的 7 项设置 + 锁定(spec §3.1–3.2)。创建与房主修改共用;未给出的键不发送(PATCH 是任意子集)。 */
export interface RoomSettingsInput {
  name?: string; scenario?: string; level?: string; joinMode?: "code" | "approval"; maxMembers?: number; aiPublic?: boolean; allowVoice?: boolean; locked?: boolean;
}
/** 输入房间号加入:凭房间号的房间直接加入(200 {room}),需房主同意的房间建一条请求(202 {request})。 */
export type JoinResult = { kind: "joined"; room: RoomInfo } | { kind: "pending"; request: JoinRequestInfo };

/** v2 新增的服务端错误原文 → i18n key(create/i18n)。 */
export const ROOMS_V2_SERVER_ERRORS: Record<string, string> = {
  "Invalid settings": "web.rooms.v2.errors.invalidSettings",
  "Below current members": "web.rooms.v2.errors.belowMembers",
  "Try again later": "web.rooms.v2.errors.tryLater",
  "Too many requests for this room": "web.rooms.v2.errors.tooManyRequests",
  "Request not found": "web.rooms.v2.errors.requestNotFound",
  "Room tutor is running": "web.rooms.agents.errors.tutorActive",
};
/** v1 + v2 的房间错误表(translateServerError 的 extra)。邀请链接的接口只在 `extras/invite-api.ts`(review m11)。 */
export const ROOMS_ALL_SERVER_ERRORS: Record<string, string> = { ...ROOMS_SERVER_ERRORS, ...ROOMS_V2_SERVER_ERRORS };

const rid = (id: string) => `/api/rooms/${encodeURIComponent(id)}`;
const reqPath = (id: string) => `/api/rooms/requests/${encodeURIComponent(id)}`;

/** 只发送给出的键;ApiClient 会把 camelCase 改成服务端的 snake_case。 */
function settingsBody(input: RoomSettingsInput): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(input)) if (value !== undefined) out[key] = value;
  return out;
}

/** 创建房间。空名(或只有空白)不发送,由服务端填「{用户名}的房间」。 */
export async function createRoomV2(api: ApiClient, input: RoomSettingsInput): Promise<RoomInfo> {
  const body = settingsBody(input);
  if (typeof body.name === "string" && body.name.trim() === "") delete body.name;
  return (await api.request<{ room: RoomInfo }>("POST", "/api/rooms", { json: body })).room;
}
/** 房主修改设置(任意子集);人数上限低于当前成员数 → 409 Below current members。 */
export async function updateRoomSettings(api: ApiClient, roomId: string, input: RoomSettingsInput): Promise<RoomInfo> {
  return (await api.request<{ room: RoomInfo }>("PATCH", rid(roomId), { json: settingsBody(input) })).room;
}
/** 响应体带 request 即为待审批(202),否则是 {room}。 */
export async function joinRoomV2(api: ApiClient, code: string): Promise<JoinResult> {
  const res = await api.request<{ room?: RoomInfo; request?: JoinRequestInfo }>("POST", "/api/rooms/join", { json: { code } });
  if (res.request) return { kind: "pending", request: res.request };
  return { kind: "joined", room: res.room as RoomInfo };
}
/** 请求者查询自己的加入请求。 */
export async function getJoinRequest(api: ApiClient, requestId: string, signal?: AbortSignal): Promise<JoinRequestInfo> {
  return (await api.request<{ request: JoinRequestInfo }>("GET", reqPath(requestId), { signal })).request;
}
/** 请求者撤回 → cancelled。 */
export async function cancelJoinRequest(api: ApiClient, requestId: string): Promise<JoinRequestInfo> {
  return (await api.request<{ request: JoinRequestInfo }>("DELETE", reqPath(requestId))).request;
}
/** 房主:本房全部待处理请求。 */
export async function listJoinRequests(api: ApiClient, roomId: string, signal?: AbortSignal): Promise<JoinRequestInfo[]> {
  return (await api.request<{ requests: JoinRequestInfo[] }>("GET", `${rid(roomId)}/requests`, { signal })).requests;
}
/** 房主同意 / 拒绝;同意时人数已满 → 409 Room is full。 */
export async function decideJoinRequest(api: ApiClient, roomId: string, requestId: string, approve: boolean): Promise<JoinRequestInfo> {
  const path = `${rid(roomId)}/requests/${encodeURIComponent(requestId)}/${approve ? "approve" : "deny"}`;
  return (await api.request<{ request: JoinRequestInfo }>("POST", path)).request;
}
