// 背单词接口(设计文档 2026-10-10-wordbook §7)。类型与函数签名是各车道共用的最终形状(计划 P-W4):改签名需要 Addendum。
// 服务端响应为 snake_case,ApiClient 自动转 camelCase;请求体的键自动转 snake_case(值不受影响)。
import type { ApiClient } from "~/api/client";

export type BookId = "junior" | "senior" | "cet4" | "cet6" | "kaoyan" | "toefl" | "sat";
export interface WordbookBook { id: BookId; titleZh: string; titleEn: string; level: number; words: number; available: boolean }
export type WordbookConfig =
  | { enabled: false }
  | {
      enabled: true; aiAvailable: boolean; defaults: { dailyNew: number; reviewCap: number }; books: WordbookBook[];
      /** 背单词 v2(spec 2026-10-11-wordbook-recall §7):新词卡 / 翻面自动朗读、翻开后显示例句。 */
      learn: { autoplay: boolean; showExample: boolean };
      /** 每日目标范围(spec 2026-10-11-wordbook-goals §9)。老版本服务端没有这个键:一律经 limitsOf 取值。 */
      limits?: GoalLimits;
    };
export interface BookProgress extends Omit<WordbookBook, "available"> { learned: number; mastered: number; enrolled: boolean; active: boolean }
export type OrderMode = "shuffle" | "book";
export interface Enrollment { bookId: BookId; status: "active" | "paused"; orderMode: OrderMode; dailyNew: number; reviewCap: number; startedAt: string; reviewUnlimited: boolean }
export interface DayPlan { newTarget: number; newDone: number; newLeft: number; reviewDue: number; reviewDone: number; reviewLeft: number; backlogGuard: boolean; bonus: number; goalMet: boolean }
export interface Progress { words: number; learned: number; mastered: number; remaining: number }
export interface Today { enrollment: Enrollment | null; book: WordbookBook | null; plan: DayPlan | null; progress: Progress | null; tomorrowDue: number; paused: Enrollment | null; streak: Streak }
export interface Sense { pos: string; text: string }
export interface Example { id: string; en: string; zh: string }
export interface Card { key: string; word: string; us: string; uk: string; senses: Sense[]; phrases: { en: string; zh: string }[]; examples: Example[] }
export type QType = "meaning" | "word" | "cloze" | "dictation" | "spell" | "recall";
export interface Question { key: string; qtype: QType; prompt: { word?: string; us?: string; meaning?: string; sentence?: string; zh?: string }; options: string[] | null; length: number | null }
/** 三档自评(spec 2026-10-11-wordbook-recall):盒子由服务端决定。 */
export type Rating = "know" | "fuzzy" | "unknown";
export type Outcome = "correct" | "typo" | "inflection" | "wrong";
/** 客观题判分结果(排除自评的 know / fuzzy / unknown / pending 与旧的 known)。 */
export const isOutcome = (o: string): o is Outcome => o === "correct" || o === "typo" || o === "inflection" || o === "wrong";
export type Grade = "good" | "hard" | "forgot";
export interface DiffOp { op: "eq" | "sub" | "ins" | "del"; a: string; b: string }
export interface ItemState { box: number; dueAt: string }
export interface AnswerInput {
  bookId: BookId; key: string; mode: "learn" | "review"; qtype: QType; choice?: string; typed?: string; hinted?: boolean; known?: boolean;
  rating?: Rating; revealedBefore?: boolean; elapsedMs?: number;
}
/**
 * `expected` = 词头;`correctOption` = 选择题正确项原文(打字题 / 自评为 null;Ruling Z-e)。
 * 自评题:`rating` = 服务端算出的有效评级(非自评题为 null),`spotCheck` = 学新词本轮要抽查,
 * `check` = 复习抽查题(`outcome:"pending"` 时先答它,此时 `grade` 为 null)。
 */
export interface AnswerResult {
  correct: boolean; outcome: Outcome | "known" | Rating | "pending"; grade: Grade | null; expected: string; correctOption: string | null;
  diff: DiffOp[] | null; item: ItemState | null; applied: boolean; rating: Rating | null; spotCheck: boolean; check: Question | null;
}
/** 空的 `form` = 句中实际词形(go → went):只用于首字母提示与「听这句」,提交前不渲染进空里(Ruling Z-c)。 */
export type Segment = { t: "text"; v: string } | { t: "blank"; i: number; len: number; form: string };
export interface ClozeLine { key: string; sentenceId: string; segments: Segment[]; zh: string }
export interface ClozeSet { setId: string; lines: ClozeLine[] }
export interface BlankResult { i: number; outcome: Outcome; credit: number; typed: string; expected: string; diff: DiffOp[] }
export interface SpellWordResult { key: string; outcome: Outcome; credit: number; blanks: BlankResult[]; card: Card; item: ItemState | null }
export interface SpellResult { credit: number; counted: boolean; words: SpellWordResult[] }
export interface SpellAnswerLine { key: string; sentenceId: string; answers: { typed: string; hinted: boolean }[] }

/** 本地时区相对 UTC 的分钟数(东八区 = 480),服务端据此算「今天」。 */
export const localOffsetMinutes = () => -new Date().getTimezoneOffset();

/** 服务端错误原文 → i18n key(传给 translateServerError 的 extra 表)。 */
export const WORDBOOK_SERVER_ERRORS: Record<string, string> = {
  "Wordbook is disabled": "web.wordbook.errors.disabled",
  "Book not found": "web.wordbook.errors.bookNotFound",
  "Wordbook data unavailable": "web.wordbook.errors.dataUnavailable",
  "No active book": "web.wordbook.errors.noActiveBook",
  "Book is not active": "web.wordbook.errors.bookNotActive",
  "Daily answer limit reached": "web.wordbook.errors.answerLimit",
  "Daily new-word limit reached": "web.wordbook.errors.newLimit",
  "Daily report limit reached": "web.wordbook.errors.reportLimit",
  "Sentence changed": "web.wordbook.errors.sentenceChanged",
  "Question type mismatch": "web.wordbook.errors.qtypeMismatch",
  "AI explanation unavailable": "web.wordbook.errors.aiUnavailable",
  "Word not found": "web.wordbook.errors.wordNotFound",
  "Rating is required": "web.wordbook.recall.errors.ratingRequired",
  "No changes": "web.wordbook.goals.errors.noChanges",
  "Daily new words out of range": "web.wordbook.goals.errors.outOfRangeNew",
  "Review cap out of range": "web.wordbook.goals.errors.outOfRangeReview",
  "Unlimited reviews are off": "web.wordbook.goals.errors.unlimitedOff",
  "Conflicting review cap": "web.wordbook.goals.errors.conflicting",
  "Too many settings changes today": "web.wordbook.goals.errors.settingsLimit",
  "Book not enrolled": "web.wordbook.goals.errors.notEnrolled",
  "Finish today's new words first": "web.wordbook.goals.errors.goalNotDone",
  "Clear the review backlog first": "web.wordbook.goals.errors.backlog",
  "No new words left in this book": "web.wordbook.goals.errors.bookFinished",
  "Daily bonus limit reached": "web.wordbook.goals.errors.bonusLimit",
  "Daily reset limit reached": "web.wordbook.goals.errors.resetLimit",
  "Confirmation does not match": "web.wordbook.goals.errors.confirmMismatch",
};

const tz = () => ({ tzOffsetMinutes: localOffsetMinutes() });

export const fetchWordbookConfig = (api: ApiClient, signal?: AbortSignal) =>
  api.request<WordbookConfig>("GET", "/api/wordbook/config", { signal });

export const fetchBooks = async (api: ApiClient, signal?: AbortSignal): Promise<BookProgress[]> =>
  (await api.request<{ books: BookProgress[] }>("GET", "/api/wordbook/books", { signal })).books;

export const saveEnrollment = (
  api: ApiClient,
  input: { bookId: BookId; dailyNew?: number; reviewCap?: number; reviewUnlimited?: true; orderMode?: OrderMode },
) => api.request<Enrollment>("PUT", "/api/wordbook/enrollment", { json: input });

export const fetchToday = (api: ApiClient, signal?: AbortSignal) =>
  api.request<Today>("GET", "/api/wordbook/today", { query: { tz_offset_minutes: localOffsetMinutes() }, signal });

export const learnBatch = (api: ApiClient, size = 5) =>
  api.request<{ bookId: BookId; cards: Card[]; quiz: Question[]; drill: Question[] }>("POST", "/api/wordbook/learn/batch", {
    json: { size, ...tz() },
  });

/**
 * 服务端的 `cards` 是列表(每张卡带 key;以词为键的映射会被响应的 camelCase 转换改写,如 "used to"、"well-known")。
 * 这里按每张卡自己的 `key` 建映射给页面用。
 * `opts.recall` = 客户端声明支持「快速回忆」题型(spec 2026-10-11-wordbook-recall §4.1);不声明时出题与 v1 相同。
 */
export const reviewBatch = async (
  api: ApiClient,
  size = 20,
  opts: { recall?: boolean } = {},
): Promise<{ bookId: BookId; questions: Question[]; cards: Record<string, Card> }> => {
  const res = await api.request<{ bookId: BookId; questions: Question[]; cards: Card[] }>(
    "POST", "/api/wordbook/review/batch", { json: { size, ...(opts.recall ? { recall: true } : {}), ...tz() } },
  );
  return { ...res, cards: Object.fromEntries((res.cards ?? []).map((card) => [card.key, card])) };
};

export const submitAnswer = (api: ApiClient, input: AnswerInput) =>
  api.request<AnswerResult>("POST", "/api/wordbook/answers", { json: { ...input, ...tz() } });

export const spellSets = (api: ApiClient, opts: { count?: number; size?: number } = {}) =>
  api.request<{ bookId: BookId; sets: ClozeSet[] }>("POST", "/api/wordbook/spell/sets", {
    json: { count: opts.count ?? 2, size: opts.size ?? 5, ...tz() },
  });

export const submitSpell = (api: ApiClient, input: { bookId: BookId; setId: string; lines: SpellAnswerLine[] }) =>
  api.request<SpellResult>("POST", "/api/wordbook/spell/submit", { json: { ...input, ...tz() } });

export const fetchCard = (api: ApiClient, bookId: BookId, key: string, signal?: AbortSignal) =>
  api.request<Card>("GET", `/api/wordbook/cards/${encodeURIComponent(bookId)}/${encodeURIComponent(key)}`, { signal });

export const explainWord = (api: ApiClient, key: string) =>
  api.request<{ key: string; text: string; cached: boolean }>("POST", "/api/wordbook/explain", { json: { key } });

export const reportSentence = (
  api: ApiClient,
  input: { bookId: BookId; key: string; sentenceId: string; reason: "wrong" | "offensive" | "other" },
) => api.request<{ id: number }>("POST", "/api/wordbook/reports", { json: input });

// ---- 每日目标(goals v2,spec 2026-10-11 §9;计划 2026-10-11 GW2 = P-W4 Addendum)----

export interface GoalLimits { dailyNew: { min: number; max: number }; reviewCap: { min: number; max: number }; reviewUnlimited: boolean; bonusMax: number }
export interface Streak { current: number; todayMet: boolean }
export interface GoalsPatch { dailyNew?: number; reviewCap?: number; reviewUnlimited?: true; orderMode?: OrderMode }
export interface BonusResult { plan: DayPlan; bonusLeft: number }
export interface ResetResult { removed: number; enrollment: Enrollment }

/** 服务端硬边界(老版本服务端的 config 没有 limits 时使用) */
export const DEFAULT_LIMITS: GoalLimits = { dailyNew: { min: 1, max: 200 }, reviewCap: { min: 10, max: 1000 }, reviewUnlimited: true, bonusMax: 50 };

export const limitsOf = (config: WordbookConfig | null): GoalLimits =>
  (config?.enabled && config.limits ? config.limits : DEFAULT_LIMITS);

export const patchEnrollment = (api: ApiClient, input: GoalsPatch) =>
  api.request<Enrollment>("PATCH", "/api/wordbook/enrollment", { json: input });

export const grantBonus = (api: ApiClient, size: number) =>
  api.request<BonusResult>("POST", "/api/wordbook/bonus", { json: { size, ...tz() } });

export const pauseEnrollment = (api: ApiClient) =>
  api.request<Enrollment>("POST", "/api/wordbook/enrollment/pause", { json: {} });

export const resumeEnrollment = (api: ApiClient, bookId: BookId) =>
  api.request<Enrollment>("POST", "/api/wordbook/enrollment/resume", { json: { bookId } });

export const resetProgress = (api: ApiClient, bookId: BookId, confirm: string) =>
  api.request<ResetResult>("POST", "/api/wordbook/enrollment/reset", { json: { bookId, confirm, ...tz() } });
