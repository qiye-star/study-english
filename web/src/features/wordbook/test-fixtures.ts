// 测试共用的服务端响应样例(snake_case,与 spec §7 一致;ApiClient 会转成 camelCase)。只被 *.test.tsx 引用。
export const CONFIG = {
  enabled: true, ai_available: false, defaults: { daily_new: 20, review_cap: 100 },
  learn: { autoplay: true, show_example: true },
  books: [
    { id: "cet4", title_zh: "四级", title_en: "CET-4", level: 3, words: 4544, available: true },
    { id: "cet6", title_zh: "六级", title_en: "CET-6", level: 4, words: 3991, available: true },
  ],
};

export const PLAN = { new_target: 20, new_done: 8, new_left: 12, review_due: 34, review_done: 0, review_left: 34, backlog_guard: false };

export const ENROLLMENT = {
  book_id: "cet4", status: "active", order_mode: "shuffle", daily_new: 20, review_cap: 100, started_at: "2026-10-01T00:00:00+00:00",
};

export const ENROLLED_TODAY = {
  enrollment: ENROLLMENT,
  book: CONFIG.books[0],
  plan: PLAN,
  progress: { words: 4544, learned: 860, mastered: 312, remaining: 3684 },
  tomorrow_due: 41,
};

export const NO_BOOK_TODAY: Record<string, unknown> = { enrollment: null, book: null, plan: null, progress: null, tomorrow_due: 0 };

export const BOOKS = {
  books: [
    { id: "cet4", title_zh: "四级", title_en: "CET-4", level: 3, words: 4544, learned: 860, mastered: 312, enrolled: true, active: true },
    { id: "cet6", title_zh: "六级", title_en: "CET-6", level: 4, words: 3991, learned: 0, mastered: 0, enrolled: false, active: false },
  ],
};

export const card = (key: string, extra: Record<string, unknown> = {}) => ({
  key, word: key, us: `us-${key}`, uk: `uk-${key}`,
  senses: [{ pos: "v.", text: `${key} 的释义` }],
  phrases: [{ en: `${key} about`, zh: "短语" }],
  examples: [{ id: `ex-${key}`, en: `They ${key} a lot.`, zh: `他们常常${key}。` }],
  ...extra,
});

/** useId 生成的 id(":r0:" 之类)随渲染顺序变化,换成固定占位再比较 DOM 字符串。 */
export const normalizeIds = (html: string) => html.replace(/:r[0-9a-z]+:/g, ":rN:");
