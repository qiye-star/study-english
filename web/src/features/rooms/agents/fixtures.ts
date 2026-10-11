import type { RoomInfo, RoomMessage, RoomTutorInfo } from "../protocol";
import type { RoomAgent } from "./room-agents-api";

/** Test-only fixtures (kept out of *.test.ts so importing them does not re-run tests). */
export const ME = 12345678; // renderWithProviders' default user id (as a number in room state)
export const EMMA: RoomAgent = { id: "builtin:coach", name: "Emma", intro: "英语教练", level: "B1", style: "friendly", builtin: true,
  promptPublic: true, prompt: "You are a patient coach.", disabled: false };
export const LEO: RoomAgent = { id: "u1", name: "Leo", intro: "点评官", level: "B2", style: "strict", builtin: false,
  promptPublic: false, prompt: null, disabled: false };
/** GET /api/rooms/r1/agents as the server sends it (snake_case). */
export const AGENTS_WIRE = { available: true, tutor: null as Record<string, unknown> | null, agents: [
  { id: "builtin:coach", name: "Emma", intro: "英语教练", level: "B1", style: "friendly", builtin: true, prompt_public: true, prompt: "You are a patient coach.", disabled: false },
] };
export const ROOM_INFO: RoomInfo = { id: "r1", code: "482913", topic: "面试", status: "open", locked: false, aiPublic: true, aiMuted: false,
  ownerId: ME, myRole: "owner", memberCount: 2, onlineCount: 2, createdAt: "", closedAt: null, name: "面试", scenario: "free", level: "B1",
  joinMode: "code", maxMembers: 4, allowVoice: true, agentIds: ["builtin:coach"] };
export const ROOM_WIRE = { id: "r1", code: "482913", topic: "面试", status: "open", locked: false, ai_public: true, ai_muted: false,
  owner_id: ME, my_role: "owner", member_count: 2, online_count: 2, created_at: "", closed_at: null as string | null, name: "面试", scenario: "free",
  level: "B1", join_mode: "code", max_members: 4, allow_voice: true, agent_ids: ["builtin:coach"] };
export const TUTOR: RoomTutorInfo = { personaId: "builtin:coach", personaName: "Emma", phase: "await_answer", stepIndex: 2, stepsTotal: 8,
  currentUserId: ME, currentName: "alice", deadlineAt: "2026-10-12T09:01:00Z", remainingMs: 42_000, startedBy: ME, pausedReason: null };
const BASE: RoomMessage = { seq: 1, id: "m1", lane: "public", kind: "text", sender: { kind: "user", id: 22, name: "bob" }, text: "hi",
  assisted: false, replyTo: null, aiStatus: null, meta: null, createdAt: "2026-10-12T09:00:00Z", quote: null, voice: null, reactions: [] };
export const msg = (over: Partial<RoomMessage>): RoomMessage => ({ ...BASE, id: `m${over.seq ?? 1}`, ...over });
export const answer = (seq: number, replyTo: number, meta: Record<string, unknown>, text = "Sure, try: I never abandon a project.") =>
  msg({ seq, kind: "ai_answer", replyTo, text, sender: { kind: "ai", id: null, name: null }, meta });
