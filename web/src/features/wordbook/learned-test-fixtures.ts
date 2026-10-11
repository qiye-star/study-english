// 已学词与自由复习的服务端响应样例(snake_case;计划 2026-10-12-wordbook-learned-review)。只被 *.test.ts(x) 引用。
import { card } from "./test-fixtures";

export const LEARNED_SUMMARY = {
  total: 6, by_box: [1, 2, 1, 1, 1, 0], by_tier: { learning: 3, growing: 2, mastered: 1 },
  by_book: [{ book_id: "cet4", count: 6 }], weak: 2, yesterday: 2, last7: 6,
};
// due_at 用远未来 / 远过去,让「已到期」的断言不依赖真实时钟
export const LEARNED_ITEMS = [
  { book_id: "cet4", key: "accept", word: "accept", box: 1, tier: "learning", learned_at: "2026-10-12T02:00:00+00:00", due_at: "2999-10-13T02:00:00+00:00", weak: true },
  { book_id: "cet4", key: "carry", word: "carry", box: 3, tier: "growing", learned_at: "2026-10-11T02:00:00+00:00", due_at: "2026-10-01T02:00:00+00:00", weak: false },
  { book_id: "cet4", key: "talk", word: "talk", box: 5, tier: "mastered", learned_at: "2026-10-05T02:00:00+00:00", due_at: "2999-11-05T02:00:00+00:00", weak: false },
];
export const LEARNED_PAGE = { items: LEARNED_ITEMS, next_cursor: null as string | null };
export const FREE_SET = {
  set_id: "abcdef012345", scope: "all", mode: "choice",
  items: [
    { book_id: "cet4", card: card("accept"), question: { key: "accept", qtype: "word", prompt: { meaning: "vt. 接受" }, options: ["accept", "stop", "go", "child"], length: null as number | null } },
    { book_id: "cet4", card: card("talk"), question: { key: "talk", qtype: "spell", prompt: { meaning: "v. 说话", us: "tɔk" }, options: null as string[] | null, length: 4 as number | null } },
  ],
};
export const FREE_SET_BROWSE = { ...FREE_SET, mode: "browse", items: FREE_SET.items.map((i) => ({ ...i, question: null as unknown })) };
