/** 房间治理与举报接口(lane community D6;服务端 routers/admin_rooms.py)。wire 是 snake_case,这里转成 camelCase。 */
import { request } from "../../api/client";

const enc = encodeURIComponent;

export type RoomStatus = "open" | "closed";
export type RoomStatusFilter = RoomStatus | "all";
export type Lane = "public" | "all";
export type Resolution = "dismissed" | "removed_message" | "kicked" | "closed_room";
export type ReportStatus = "open" | "resolved";

export interface RoomRow {
  id: string;
  code: string | null;
  lastCode: string;
  topic: string;
  status: RoomStatus;
  /** id null = the owner was deleted and nobody else had joined: the room is kept closed and read-only */
  owner: { id: number | null; name: string | null };
  memberCount: number;
  onlineCount: number;
  messageCount: number;
  openReports: number;
  locked: boolean;
  aiPublic: boolean;
  aiMuted: boolean;
  createdAt: string;
  lastActiveAt: string;
  closedAt: string | null;
  closeReason: string | null;
}

export interface RoomMember {
  userId: number;
  name: string | null;
  role: "owner" | "member";
  joinedAt: string;
  leftAt: string | null;
  kicked: boolean;
  online: boolean;
}

export interface RoomDetail extends RoomRow {
  reportCount: number;
  members: RoomMember[];
}

export interface AdminMessage {
  seq: number;
  id: string;
  lane: "public" | "private";
  kind: "text" | "ai_answer" | "system" | "assist_request" | "assist_reply";
  sender: { kind: "user" | "ai" | "system"; id: number | null; name: string | null };
  audience: { id: number; name: string | null } | null;
  text: string;
  meta: Record<string, unknown> | null;
  assisted: boolean;
  replyTo: number | null;
  aiStatus: string | null;
  createdAt: string;
  hidden: boolean;
  hiddenAt: string | null;
}

export interface Timeline {
  messages: AdminMessage[];
  nextBeforeSeq: number | null;
}

export interface Report {
  id: number;
  room: { id: string; topic: string; code: string };
  message: { id: string; seq: number; text: string; hidden: boolean; sender: { kind: string; id: number | null; name: string | null } } | null;
  reporter: { id: number; name: string | null };
  reason: string;
  createdAt: string;
  resolvedAt: string | null;
  resolvedBy: string | null;
  resolution: Resolution | null;
}

const camelKey = (k: string) => k.replace(/_([a-z])/g, (_, c: string) => c.toUpperCase());

/** snake_case → camelCase(深层);`meta` 是消息自带的数据,原样保留。 */
function camel<T>(value: unknown): T {
  if (Array.isArray(value)) return value.map((v) => camel(v)) as T;
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) out[camelKey(k)] = k === "meta" ? v : camel(v);
    return out as T;
  }
  return value as T;
}

export async function listRooms(p: { status: RoomStatusFilter; q: string; page: number }) {
  const r = await request<unknown>("/api/admin/rooms", { query: { status: p.status, q: p.q.trim() || undefined, page: p.page } });
  return camel<{ rooms: RoomRow[]; page: number; next: number | null; total: number }>(r);
}

export async function getRoom(id: string): Promise<RoomDetail> {
  return camel<RoomDetail>(await request<unknown>(`/api/admin/rooms/${enc(id)}`));
}

/** lane=all 会在服务端写审计 `room.view_private`。 */
export async function getRoomMessages(id: string, p: { lane: Lane; beforeSeq: number | null }): Promise<Timeline> {
  const r = await request<unknown>(`/api/admin/rooms/${enc(id)}/messages`, { query: { lane: p.lane, before_seq: p.beforeSeq } });
  return camel<Timeline>(r);
}

export async function closeRoom(id: string, reason: string): Promise<void> {
  await request(`/api/admin/rooms/${enc(id)}/close`, { method: "POST", json: { reason } });
}

export async function kickMember(id: string, userId: number, reason: string): Promise<void> {
  await request(`/api/admin/rooms/${enc(id)}/kick`, { method: "POST", json: { user_id: userId, reason } });
}

export async function setRoomAi(id: string, muted: boolean, reason: string): Promise<{ aiMuted: boolean }> {
  return camel<{ aiMuted: boolean }>(await request<unknown>(`/api/admin/rooms/${enc(id)}/ai`, { method: "POST", json: { muted, reason } }));
}

export async function hideMessage(id: string, messageId: string, reason: string): Promise<void> {
  await request(`/api/admin/rooms/${enc(id)}/messages/${enc(messageId)}/hide`, { method: "POST", json: { reason } });
}

export async function listReports(status: ReportStatus, page: number) {
  return camel<{ reports: Report[]; page: number; next: number | null }>(await request<unknown>("/api/admin/reports", { query: { status, page } }));
}

export async function resolveReport(id: number, resolution: Resolution, reason: string): Promise<void> {
  await request(`/api/admin/reports/${id}/resolve`, { method: "POST", json: { resolution, reason } });
}
