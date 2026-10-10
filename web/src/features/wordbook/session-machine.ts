/**
 * 学新词小测与复习的会话队列(纯函数;spec §6.3):答错的词放回队尾再测,每个词最多再排 MAX_REQUEUE 次;
 * firstTry 记每个词第一次作答是否正确(小结里的「一次答对」)。
 */
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
