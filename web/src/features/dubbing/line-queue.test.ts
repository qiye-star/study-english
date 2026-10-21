import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "~/api/client";
import type { LineResult } from "./dubbing-api";
import { createLineQueue, type LineQueueDeps, type QueueItem } from "./line-queue";

const item = (idx: number, over: Partial<QueueItem> = {}): QueueItem => ({
  idx, recStartMs: idx * 1000, capture: "pcm", noSpeech: false, voicedMs: 300, wav: new Blob(["x"]), ...over,
});
const LINE: LineResult = { segIdx: 0, pronunciation: 90, fluency: 80, sync: 70, syncBasis: "words", score: 84 };

/** 可手动决议的 Promise,用来控制在途请求。 */
function deferred<T>() {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

function deps(over: Partial<LineQueueDeps> = {}): LineQueueDeps & { assess: ReturnType<typeof vi.fn>; post: ReturnType<typeof vi.fn> } {
  return {
    assess: vi.fn(async () => ({ assessmentId: "a-1" })),
    post: vi.fn(async () => LINE),
    ...over,
  } as LineQueueDeps & { assess: ReturnType<typeof vi.fn>; post: ReturnType<typeof vi.fn> };
}

describe("line queue (plan L5 W6)", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("runs at most two assessments at a time", async () => {
    const gates = [deferred<{ assessmentId: string }>(), deferred<{ assessmentId: string }>(), deferred<{ assessmentId: string }>()];
    const d = deps({ assess: vi.fn((it: QueueItem) => gates[it.idx].promise) as LineQueueDeps["assess"] });
    const q = createLineQueue(d, 2);
    q.enqueue(item(0)); q.enqueue(item(1)); q.enqueue(item(2));
    expect(d.assess).toHaveBeenCalledTimes(2);
    gates[0].resolve({ assessmentId: "a0" });
    await vi.advanceTimersByTimeAsync(0);
    expect(d.assess).toHaveBeenCalledTimes(3);
    gates[1].resolve({ assessmentId: "a1" });
    gates[2].resolve({ assessmentId: "a2" });
    const out = await q.drain(60_000);
    expect(out.map((o) => o.status)).toEqual(["scored", "scored", "scored"]);
  });

  it("a window with no speech sends no request and is recorded as missing", async () => {
    const d = deps();
    const q = createLineQueue(d);
    q.enqueue(item(4, { noSpeech: true, wav: null }));
    const out = await q.drain(60_000);
    expect(d.assess).not.toHaveBeenCalled();
    expect(d.post).not.toHaveBeenCalled();
    expect(out).toEqual([{ idx: 4, status: "missing", reason: "no_speech", messageKey: null }]);
  });

  it("a scored sentence is assessed, then posted with the assessment id", async () => {
    const d = deps();
    const q = createLineQueue(d);
    q.enqueue(item(2));
    const out = await q.drain(60_000);
    expect(d.post).toHaveBeenCalledWith(expect.objectContaining({ idx: 2 }), "a-1", expect.any(AbortSignal));
    expect(out).toEqual([{ idx: 2, status: "scored", line: LINE }]);
  });

  it("a failed assessment is missing, with the practice error text mapped to a key", async () => {
    const d = deps({ assess: vi.fn(async () => { throw new ApiError(400, "Audio must be a 16 kHz mono 16-bit WAV"); }) as LineQueueDeps["assess"] });
    const q = createLineQueue(d);
    q.enqueue(item(1));
    const out = await q.drain(60_000);
    expect(d.post).not.toHaveBeenCalled();
    expect(out).toEqual([{ idx: 1, status: "missing", reason: "failed", messageKey: "web.practice.errors.badAudio" }]);
  });

  it("a refused post (already recorded) is missing with the dubbing error key", async () => {
    const d = deps({ post: vi.fn(async () => { throw new ApiError(409, "Line already recorded"); }) as LineQueueDeps["post"] });
    const q = createLineQueue(d);
    q.enqueue(item(3));
    const out = await q.drain(60_000);
    expect(out).toEqual([{ idx: 3, status: "missing", reason: "failed", messageKey: "web.dubbing.errors.lineDone" }]);
  });

  it("drain times out: pending and in-flight sentences are missing as timeout, and in-flight requests are cancelled", async () => {
    const gate = deferred<{ assessmentId: string }>();
    let signal: AbortSignal | undefined;
    const d = deps({ assess: vi.fn((_it: QueueItem, s: AbortSignal) => { signal = s; return gate.promise; }) as LineQueueDeps["assess"] });
    const q = createLineQueue(d, 1);
    q.enqueue(item(0)); q.enqueue(item(1));
    const drained = q.drain(5_000);
    await vi.advanceTimersByTimeAsync(5_000);
    const out = await drained;
    expect(out).toEqual([
      { idx: 0, status: "missing", reason: "timeout", messageKey: null },
      { idx: 1, status: "missing", reason: "timeout", messageKey: null },
    ]);
    expect(signal?.aborted).toBe(true);
    expect(d.post).not.toHaveBeenCalled();
  });

  it("abort cancels in flight and never posts after it, even if the assessment finishes later", async () => {
    const gate = deferred<{ assessmentId: string }>();
    const d = deps({ assess: vi.fn(() => gate.promise) as LineQueueDeps["assess"] });
    const q = createLineQueue(d);
    q.enqueue(item(0));
    q.enqueue(item(1));
    q.abort();
    gate.resolve({ assessmentId: "late" });
    const out = await q.drain(60_000);
    expect(d.post).not.toHaveBeenCalled();
    expect(out.map((o) => o.status === "missing" && o.reason)).toEqual(["aborted", "aborted"]);
  });

  it("enqueue after abort records the sentence as aborted and sends nothing", async () => {
    const d = deps();
    const q = createLineQueue(d);
    q.abort();
    q.enqueue(item(5));
    expect(d.assess).not.toHaveBeenCalled();
    expect((await q.drain(60_000))[0]).toMatchObject({ idx: 5, reason: "aborted" });
  });
});
