/**
 * 学新词小测与复习的会话队列(纯函数;spec §6.3):答错的词放回队尾再测,每个词最多再排 MAX_REQUEUE 次;
 * firstTry 记每个词第一次作答是否正确(小结里的「一次答对」)。
 */
import type { Rating } from "./wordbook-api";

export const MAX_REQUEUE = 2;

export interface SessionState {
  queue: string[];
  done: string[];
  requeued: Record<string, number>;
  current: string | null;
  firstTry: Record<string, boolean>;
}

export function startSession(keys: string[]): SessionState {
  return { queue: [...keys], done: [], requeued: {}, current: keys[0] ?? null, firstTry: {} };
}

export function answerCurrent(s: SessionState, correct: boolean): SessionState {
  if (s.current === null) return s;
  const key = s.current;
  const rest = s.queue.slice(1);
  const firstTry = key in s.firstTry ? s.firstTry : { ...s.firstTry, [key]: correct };
  const count = s.requeued[key] ?? 0;
  if (!correct && count < MAX_REQUEUE) {
    const queue = [...rest, key];
    return { ...s, queue, current: queue[0], requeued: { ...s.requeued, [key]: count + 1 }, firstTry };
  }
  return { ...s, queue: rest, done: [...s.done, key], current: rest[0] ?? null, firstTry };
}

export const isFinished = (s: SessionState) => s.current === null;
export const progressOf = (s: SessionState) => ({ done: s.done.length, total: s.done.length + new Set(s.queue).size });

// ---- 背单词 v2:三档自评与本轮小测(spec 2026-10-11-wordbook-recall §3)----

export type { Rating };

/** 一张新词卡的界面状态:是否翻开、自评前是否偷看、自评结果(服务端返回的有效评级)、出现时刻(ms)。 */
export interface CardState { revealed: boolean; peeked: boolean; rating: Rating | null; shownAt: number }
export type CardAction =
  | { type: "reveal" }
  | { type: "rated"; rating: Rating }
  | { type: "corrected" }
  | { type: "reset"; at: number };

export const MAX_ELAPSED_MS = 600_000;

export function startCard(at: number): CardState {
  return { revealed: false, peeked: false, rating: null, shownAt: at };
}

export function cardReducer(s: CardState, a: CardAction): CardState {
  switch (a.type) {
    case "reveal":
      return s.revealed ? s : { ...s, revealed: true, peeked: s.rating === null };
    case "rated":
      return s.rating !== null ? s : { ...s, rating: a.rating, revealed: true };
    case "corrected": // 「记错了」:已自评的卡改为不认识(服务端只降不升)
      return s.rating === null ? s : { ...s, rating: "unknown" };
    case "reset":
      return startCard(a.at);
  }
}

/** 自评用时(ms),夹到服务端接受的 0–600000(超出会 422,停很久之后的自评就再也交不上)。 */
export function clampElapsed(ms: number): number {
  const elapsed = Math.round(ms);
  return Math.min(MAX_ELAPSED_MS, Math.max(0, Number.isFinite(elapsed) ? elapsed : 0));
}

/** 自评请求体:按下的键 + 自评前是否偷看 + 用时(夹到 0–600000 ms)。盒子由服务端决定。 */
export function ratingPayload(s: CardState, rating: Rating, now: number) {
  return { rating, revealedBefore: s.peeked, elapsedMs: clampElapsed(now - s.shownAt) };
}

export interface RatedWord { key: string; rating: Rating; spotCheck: boolean }
export type SlotQType = "meaning" | "word";
export interface QuizSlot { id: string; key: string; qtype: SlotQType }

export const slotId = (key: string, qtype: SlotQType) => `${qtype}:${key}`;
/** slotId 的逆:词本身可能含冒号,只按第一个冒号切。 */
export const slotKey = (id: string) => id.slice(id.indexOf(":") + 1);

/** 本轮小测排队:模糊 → 不认识(选释义)→ 抽中的认识 → 不认识第二次(看释义选词);没抽中的认识不考。 */
export function planLearnQuiz(rated: RatedWord[]): QuizSlot[] {
  const slot = (w: RatedWord, qtype: SlotQType): QuizSlot => ({ id: slotId(w.key, qtype), key: w.key, qtype });
  const of = (r: Rating) => rated.filter((w) => w.rating === r);
  return [
    ...of("fuzzy").map((w) => slot(w, "meaning")),
    ...of("unknown").map((w) => slot(w, "meaning")),
    ...of("know").filter((w) => w.spotCheck).map((w) => slot(w, "meaning")),
    ...of("unknown").map((w) => slot(w, "word")),
  ];
}

/** 小结计数:各评级词数、抽查数与通过数、「一次答对」(没抽中的认识 + 所有小测题都一次答对的词)、答错过的词。 */
export function learnTally(rated: RatedWord[], firstTry: Record<string, boolean>) {
  const ratings: Record<Rating, number> = { know: 0, fuzzy: 0, unknown: 0 };
  for (const w of rated) ratings[w.rating] += 1;
  const byKey = new Map<string, boolean[]>();
  for (const [id, ok] of Object.entries(firstTry)) byKey.set(slotKey(id), [...(byKey.get(slotKey(id)) ?? []), ok]);
  const checked = rated.filter((w) => w.rating === "know" && w.spotCheck);
  const passed = checked.filter((w) => firstTry[slotId(w.key, "meaning")] === true).length;
  const clean = rated.filter((w) => {
    const oks = byKey.get(w.key);
    return (w.rating === "know" && !w.spotCheck) || (oks !== undefined && oks.length > 0 && oks.every(Boolean));
  }).length;
  const missed = rated.filter((w) => byKey.get(w.key)?.some((ok) => !ok)).map((w) => w.key);
  return { ratings, checks: { total: checked.length, passed }, firstTry: clean, missed };
}