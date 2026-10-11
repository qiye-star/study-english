import type { BookId, Card, FreeSet, Question } from "./wordbook-api";

/** 自由复习复用复习页:`?source=free`,批次经路由 state 传入(答案与词卡不进 URL;R-L14)。 */
export const FREE_PATH = "/wordbook/review?source=free";

export interface FreeBatch { bookId: BookId; questions: Question[]; cards: Record<string, Card>; bookOf: Record<string, BookId> }

export const uniqueKeys = (questions: Question[]) => questions.map((q) => q.key).filter((k, i, all) => all.indexOf(k) === i);

/** 按条目建「词 → 卡」「词 → 书」映射(客户端本地建,不依赖服务端的映射;全部随机会跨书)。 */
export function toBatch(set: FreeSet): FreeBatch {
  return {
    bookId: set.items[0].bookId,
    questions: set.items.flatMap((i) => (i.question ? [i.question] : [])),
    cards: Object.fromEntries(set.items.map((i) => [i.card.key, i.card])),
    bookOf: Object.fromEntries(set.items.map((i) => [i.card.key, i.bookId])),
  };
}

export function readFreeState(state: unknown): FreeSet | null {
  const free = (state as { free?: FreeSet } | null | undefined)?.free;
  return free && typeof free === "object" && Array.isArray(free.items) && free.items.length > 0 ? free : null;
}
