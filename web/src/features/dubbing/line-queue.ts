import { ApiError } from "~/api/client";
import { PRACTICE_SERVER_ERRORS } from "~/features/practice";
import { DUBBING_SERVER_ERRORS, type LineResult } from "./dubbing-api";

/**
 * 逐句评测队列(计划 L5 R15/W6)。每句录完即入队:先评测(`POST /api/speech/assessments`,由调用方提供),
 * 再把结果交给 post(配音的 `POST …/lines`)。并发 2;无声段不发请求;片段结束后 drain(超时)等待在途;abort 取消一切。
 */

export const LINE_CONCURRENCY = 2;

export interface QueueItem {
  idx: number;
  recStartMs: number;
  capture: "pcm" | "recorder";
  noSpeech: boolean;
  voicedMs: number | null;
  wav: Blob | null;
}

export type MissingReason = "no_speech" | "failed" | "timeout" | "aborted";

export type LineOutcome =
  | { idx: number; status: "scored"; line: LineResult }
  | { idx: number; status: "missing"; reason: MissingReason; messageKey: string | null };

export interface LineQueueDeps {
  /** 评测(save=true、source=library);返回本句的评测编号 */
  assess(item: QueueItem, signal: AbortSignal): Promise<{ assessmentId: string }>;
  /** 把评测结果写进配音记录 */
  post(item: QueueItem, assessmentId: string, signal: AbortSignal): Promise<LineResult>;
}

export interface LineQueue {
  enqueue(item: QueueItem): void;
  /** 等全部句子结束;超过 timeoutMs 的剩余句子记 timeout 并取消在途请求。结果按句号排序。 */
  drain(timeoutMs: number): Promise<LineOutcome[]>;
  /** 取消在途请求,之后不再发任何请求;未完成的句子记 aborted。 */
  abort(): void;
  outcomes(): LineOutcome[];
}

/** 服务端文本 → 文案键;先查跟读的表,再查配音的表,都没有走通用提示。 */
export function errorKeyOf(err: unknown): string {
  if (err instanceof ApiError) {
    return PRACTICE_SERVER_ERRORS[err.message] ?? DUBBING_SERVER_ERRORS[err.message] ?? "web.dubbing.errors.unknown";
  }
  return "web.dubbing.errors.unknown";
}

export function createLineQueue(deps: LineQueueDeps, concurrency = LINE_CONCURRENCY): LineQueue {
  const pending: QueueItem[] = [];
  const inFlight = new Map<number, AbortController>();
  const results = new Map<number, LineOutcome>();
  let aborted = false;
  let waiters: Array<() => void> = [];

  const settle = (idx: number, outcome: LineOutcome) => {
    if (results.has(idx)) return;
    results.set(idx, outcome);
  };
  const missing = (idx: number, reason: MissingReason, messageKey: string | null = null): LineOutcome => ({
    idx, status: "missing", reason, messageKey,
  });
  const done = () => pending.length === 0 && inFlight.size === 0;
  const notify = () => {
    if (!done()) return;
    const ws = waiters;
    waiters = [];
    for (const w of ws) w();
  };

  function run(item: QueueItem) {
    const ctrl = new AbortController();
    inFlight.set(item.idx, ctrl);
    (async () => {
      try {
        const { assessmentId } = await deps.assess(item, ctrl.signal);
        if (aborted || ctrl.signal.aborted) return;
        const line = await deps.post(item, assessmentId, ctrl.signal);
        if (aborted || ctrl.signal.aborted) return;
        settle(item.idx, { idx: item.idx, status: "scored", line });
      } catch (err) {
        if (aborted || ctrl.signal.aborted) return;
        settle(item.idx, missing(item.idx, "failed", errorKeyOf(err)));
      } finally {
        inFlight.delete(item.idx);
        pump();
        notify();
      }
    })();
  }

  function pump() {
    while (!aborted && inFlight.size < concurrency && pending.length > 0) {
      const next = pending.shift();
      if (next) run(next);
    }
  }

  const outcomes = (): LineOutcome[] => [...results.values()].sort((a, b) => a.idx - b.idx);

  return {
    enqueue(item) {
      if (aborted) {
        settle(item.idx, missing(item.idx, "aborted"));
        return;
      }
      if (item.noSpeech || item.wav === null) {
        settle(item.idx, missing(item.idx, "no_speech"));
        return;
      }
      pending.push(item);
      pump();
    },
    drain(timeoutMs) {
      return new Promise<LineOutcome[]>((resolve) => {
        const finish = () => {
          clearTimeout(timer);
          waiters = waiters.filter((w) => w !== finish);
          resolve(outcomes());
        };
        const timer = setTimeout(() => {
          for (const item of pending.splice(0)) settle(item.idx, missing(item.idx, "timeout"));
          for (const [idx, ctrl] of inFlight) {
            settle(idx, missing(idx, "timeout"));
            ctrl.abort();
          }
          finish();
        }, timeoutMs);
        if (done()) finish();
        else waiters.push(finish);
      });
    },
    abort() {
      aborted = true;
      for (const item of pending.splice(0)) settle(item.idx, missing(item.idx, "aborted"));
      for (const [idx, ctrl] of inFlight) {
        settle(idx, missing(idx, "aborted"));
        ctrl.abort();
      }
      notify();
    },
    outcomes,
  };
}
