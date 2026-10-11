import type { ApiClient } from "~/api/client";
import { ROOMS_ALL_SERVER_ERRORS } from "../create/rooms-v2-api";
import type { RoomInfo, RoomTutorInfo } from "../protocol";

/** GET /api/rooms/{id}/agents 的一项(成员视图;prompt 只在 promptPublic 时有值,spec D3)。 */
export interface RoomAgent {
  id: string; name: string; intro: string; level: string; style: string; builtin: boolean; promptPublic: boolean; prompt: string | null; disabled: boolean;
}
export interface RoomAgentsInfo { available: boolean; agents: RoomAgent[]; tutor: RoomTutorInfo | null }
export type AgentReportReason = "spam" | "abuse" | "other";

/** 服务端错误原文(routers/rooms_agents.py)→ i18n key。 */
export const ROOM_AGENTS_SERVER_ERRORS: Record<string, string> = {
  "Room tutor is running": "web.rooms.agents.errors.tutorActive",
  "Agent not found": "web.rooms.agents.errors.agentNotFound",
  "Room tutor is off": "web.rooms.agents.errors.tutorOff",
  "Not an agent of this room": "web.rooms.agents.errors.notAgent",
  "AI is off in this room": "web.rooms.agents.errors.aiOff",
  "Nobody online to practise with": "web.rooms.agents.errors.noParticipants",
  "Room tutor limit reached": "web.rooms.agents.errors.tutorQuota",
  "Nobody is being asked": "web.rooms.agents.errors.notWaiting",
  "Room tutor is not paused": "web.rooms.agents.errors.notPaused",
  "Room tutor not found": "web.rooms.agents.errors.tutorNotFound",
  "Report limit reached": "web.rooms.agents.errors.reportLimit",
  "Invalid reason": "web.rooms.agents.errors.badReason",
};
export const ROOM_AGENTS_ALL_ERRORS: Record<string, string> = { ...ROOMS_ALL_SERVER_ERRORS, ...ROOM_AGENTS_SERVER_ERRORS };

const rid = (id: string) => `/api/rooms/${encodeURIComponent(id)}`;

export function fetchRoomAgents(api: ApiClient, roomId: string, signal?: AbortSignal): Promise<RoomAgentsInfo> {
  return api.request<RoomAgentsInfo>("GET", `${rid(roomId)}/agents`, { signal });
}
/** 房主改智能体(最多 2 个;[] = 清空)。带练进行中 → 409 Room tutor is running。 */
export async function updateRoomAgents(api: ApiClient, roomId: string, ids: string[]): Promise<RoomInfo> {
  return (await api.request<{ room: RoomInfo }>("PATCH", rid(roomId), { json: { agents: ids } })).room;
}
export async function reportRoomAgent(api: ApiClient, roomId: string, personaId: string, reason: AgentReportReason): Promise<void> {
  await api.request("POST", `${rid(roomId)}/agents/${encodeURIComponent(personaId)}/report`, { json: { reason } });
}
export async function startRoomTutor(api: ApiClient, roomId: string, personaId: string, steps: number): Promise<RoomTutorInfo> {
  return (await api.request<{ tutor: RoomTutorInfo }>("POST", `${rid(roomId)}/agents/tutor/start`, { json: { personaId, steps } })).tutor;
}
export async function skipRoomTutor(api: ApiClient, roomId: string): Promise<void> {
  await api.request("POST", `${rid(roomId)}/agents/tutor/skip`, {});
}
export async function stopRoomTutor(api: ApiClient, roomId: string): Promise<void> {
  await api.request("POST", `${rid(roomId)}/agents/tutor/stop`, {});
}
export async function resumeRoomTutor(api: ApiClient, roomId: string): Promise<RoomTutorInfo> {
  return (await api.request<{ tutor: RoomTutorInfo }>("POST", `${rid(roomId)}/agents/tutor/resume`, {})).tutor;
}
