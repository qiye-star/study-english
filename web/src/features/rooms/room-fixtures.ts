/** Test-only wire fixtures (snake_case, as the server sends them). Kept out of *.test.ts so importing them does not re-run tests. */
export const ROOM = { id: "r1", code: "482913", topic: "美食", status: "open", locked: false, ai_public: true, owner_id: 11111111,
  my_role: "owner", member_count: 2, online_count: 1, created_at: "2026-10-09T09:00:00+00:00", closed_at: null as string | null };
