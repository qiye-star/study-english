// 背单词接口(设计文档 2026-10-10-wordbook §7)。类型与函数签名是各车道共用的最终形状(计划 P-W4):改签名需要 Addendum。
// 服务端响应为 snake_case,ApiClient 自动转 camelCase;请求体的键自动转 snake_case(值不受影响)。
import type { ApiClient } from "~/api/client";

export type BookId = "junior" | "senior" | "cet4" | "cet6" | "kaoyan" | "toefl" | "sat";
export interface WordbookBook { id: BookId; titleZh: string; titleEn: string; level: number; words: number; available: boolean }
export type WordbookConfig =
  | { enabled: false }
  | { enabled: true; aiAvailable: boolean; defaults: { dailyNew: number; reviewCap: number }; books: WordbookBook[] };
export interface BookProgress extends Omit<WordbookBook, "available"> { learned: number; mastered: number; enrolled: boolean; active: boolean }
export type OrderMode = "shuffle" | "book";
export interface Enrollment { bookId: BookId; status: "active" | "paused"; orderMode: OrderMode; dailyNew: number; reviewCap: number; startedAt: string }
export interface DayPlan { newTarget: number; newDone: number; newLeft: number; reviewDue: number; reviewDone: number; reviewLeft: number; backlogGuard: boolean }
export interface Progress { words: number; learned: number; mastered: number; remaining: number }
export interface Today { enrollment: Enrollment | null; book: WordbookBook | null; plan: DayPlan | null; progress: Progress | null; tomorrowDue: number }
export interface Sense { pos: string; text: string }
export interface Example { id: string; en: string; zh: string }
export interface Card { key: string; word: string; us: string; uk: string; senses: Sense[]; phrases: { en: string; zh: string }[]; examples: Example[] }
export type QType = "meaning" | "word" | "cloze" | "dictation" | "spell";
export interface Question { key: string; qtype: QType; prompt: { word?: string; us?: string; meaning?: string; sentence?: string; zh?: string }; options: string[] | null; length: number | null }
export type Outcome = "correct" | "typo" | "inflection" | "wrong";
export type Grade = "good" | "hard" | "forgot";
export interface DiffOp { op: "eq" | "sub" | "ins" | "del"; a: string; b: string }
export interface ItemState { box: number; dueAt: string }
export interface AnswerInput { bookId: BookId; key: string; mode: "learn" | "review"; qtype: QType; choice?: string; typed?: string; hinted?: boolean; known?: boolean }
/** `expected` = 词头;`correctOption` = 选择题正确项原文(打字题 / 「我认识」为 null;Ruling Z-e)。 */
export interface AnswerResult { correct: boolean; outcome: Outcome | "known"; grade: Grade; expected: string; correctOption: string | null; diff: DiffOp[] | null; item: ItemState | null; applied: boolean }
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
  "AI explanation unavailable": "web.wordbook.errors.aiUnavailable",
  "Word not found": "web.wordbook.errors.wordNotFound",
};

const tz = () => ({ tzOffsetMinutes: localOffsetMinutes() });

export const fetchWordbookConfig = (api: ApiClient, signal?: AbortSignal) =>
  api.request<WordbookConfig>("GET", "/api/wordbook/config", { signal });

export const fetchBooks = async (api: ApiClient, signal?: AbortSignal): Promise<BookProgress[]> =>
  (await api.request<{ books: BookProgress[] }>("GET", "/api/wordbook/books", { signal })).books;

export const saveEnrollment = (
  api: ApiClient,
  input: { bookId: BookId; dailyNew?: number; reviewCap?: number; orderMode?: OrderMode },
) => api.request<Enrollment>("PUT", "/api/wordbook/enrollment", { json: input });

export const fetchToday = (api: ApiClient, signal?: AbortSignal) =>
  api.request<Today>("GET", "/api/wordbook/today", { query: { tz_offset_minutes: localOffsetMinutes() }, signal });

export const learnBatch = (api: ApiClient, size = 5) =>
  api.request<{ bookId: BookId; cards: Card[]; quiz: Question[] }>("POST", "/api/wordbook/learn/batch", {
    json: { size, ...tz() },
  });

/** `cards` 的键是词(如 "used to"、"well-known"):响应的 camelCase 转换会改写这些键,所以按每张卡自己的 `key` 重建。 */
export const reviewBatch = async (
  api: ApiClient,
  size = 20,
): Promise<{ bookId: BookId; questions: Question[]; cards: Record<string, Card> }> => {
  const res = await api.request<{ bookId: BookId; questions: Question[]; cards: Record<string, Card> }>(
    "POST", "/api/wordbook/review/batch", { json: { size, ...tz() } },
  );
  return { ...res, cards: Object.fromEntries(Object.values(res.cards ?? {}).map((card) => [card.key, card])) };
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
