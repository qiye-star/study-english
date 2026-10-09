import type { ApiClient } from "~/api/client";
import type { RoomInfo } from "../protocol";

/** 邀请链接(spec §3.4 / §8)。token 与票据同级保密(R2-5):只放进链接与二维码,不记录、不放进错误提示。 */
export interface RoomInvite { token: string; path: string }
export interface InvitePreview {
  roomId: string; name: string; scenario: string; level: string; memberCount: number; maxMembers: number; joined: boolean;
}

const rid = (id: string) => `/api/rooms/${encodeURIComponent(id)}`;
const inv = (token: string) => `/api/rooms/invite/${encodeURIComponent(token)}`;

/** 取(必要时生成)邀请;审批房间仅房主。 */
export function getInvite(api: ApiClient, roomId: string, signal?: AbortSignal): Promise<RoomInvite> {
  return api.request<RoomInvite>("POST", `${rid(roomId)}/invite`, { signal });
}
/** 房主重置:旧链接立即失效。 */
export function rotateInvite(api: ApiClient, roomId: string): Promise<RoomInvite> {
  return api.request<RoomInvite>("POST", `${rid(roomId)}/invite/rotate`);
}
export async function previewInvite(api: ApiClient, token: string, signal?: AbortSignal): Promise<InvitePreview> {
  return (await api.request<{ invite: InvitePreview }>("GET", inv(token), { signal })).invite;
}
/** 凭邀请加入(绕过审批,R2-4);锁定 / 已满 / 被移出 / 已结束与 v1 同样报错。 */
export async function joinByInvite(api: ApiClient, token: string): Promise<RoomInfo> {
  return (await api.request<{ room: RoomInfo }>("POST", `${inv(token)}/join`)).room;
}
