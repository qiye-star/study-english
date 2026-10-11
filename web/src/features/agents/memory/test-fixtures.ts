/** 线上形状(snake_case),与 server/tests/fixtures/agents_memory_contract.json 同构;测试用。 */
const none = null as string | null;
export const STATE = {
  profile: { level: "B1", goals: ["雅思 7 分"] }, edited_keys: ["level"], proposals: { level: "B2" },
  memory_enabled: true, memory_available: true,
};
export const COACH = { id: "builtin:coach", name: "英语教练" as string | null };
export const ITEM_A = {
  id: "a", kind: "goal", text: "准备雅思口语考试", importance: 4, pinned: false, persona: null as typeof COACH | null, source: "chat",
  created_at: "2026-10-12T08:00:00+00:00", updated_at: "2026-10-12T08:00:00+00:00",
};
export const ITEM_B = { ...ITEM_A, id: "b", kind: "weakness", text: "过去时态常出错", persona: COACH, source: "tutor" };
export const PAGE = {
  items: [ITEM_A, ITEM_B], next_cursor: none,
  persona_counts: [{ persona: null as typeof COACH | null, count: 1 }, { persona: COACH as typeof COACH | null, count: 1 }],
};
export const RECAP = {
  id: "r1", source: "tutor", persona: COACH, conversation_id: none, text: "8 题答对 6 题",
  created_at: "2026-10-12T09:00:00+00:00",
};
export const RECAPS = { recaps: [RECAP], next_cursor: none };
export const CLEAR = { scope: "all", deleted: { items: 2, recaps: 1, threads: 0, profile: true } };
export const EXPORT = {
  version: 1, exported_at: "2026-10-12T10:00:00+00:00",
  profile: { data: STATE.profile, edited_keys: ["level"], proposals: { level: "B2" } },
  items: [{ ...ITEM_A, persona_id: none, last_used_at: none }], recaps: [{ ...RECAP, persona_id: "builtin:coach", tutor_session_id: "t-1" }],
  threads: [] as unknown[], tombstones: 0,
};
