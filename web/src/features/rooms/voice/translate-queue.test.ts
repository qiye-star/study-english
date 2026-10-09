import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AUTO_TRANSLATE_INFLIGHT, AUTO_TRANSLATE_PER_MINUTE, TRANSLATE_STALL_MS, TranslateQueue } from "./translate-queue";

describe("TranslateQueue (review M3)", () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  it("stays under the server's 20 per minute and keeps only a few requests in flight", () => {
    expect(AUTO_TRANSLATE_PER_MINUTE).toBeLessThan(20);
    const send = vi.fn((_seq: number) => true);
    const q = new TranslateQueue(send);
    const results: Record<number, boolean> = {};
    for (let seq = 1; seq <= 30; seq += 1) q.request(seq, (ok) => { results[seq] = ok; });
    expect(send).toHaveBeenCalledTimes(AUTO_TRANSLATE_INFLIGHT);
    // answers arrive: each settles a slot, but the minute window caps the total
    for (let round = 0; round < 40; round += 1) {
      for (const [seq] of send.mock.calls.slice(-AUTO_TRANSLATE_INFLIGHT) as unknown as [number][]) q.settle(seq);
    }
    expect(send.mock.calls.length).toBeLessThanOrEqual(AUTO_TRANSLATE_PER_MINUTE);
    const before = send.mock.calls.length;
    vi.advanceTimersByTime(61_000);
    expect(send.mock.calls.length).toBeGreaterThan(before); // the next minute continues the queue
  });

  it("frees a slot when no answer arrives in time and reports offline sends", () => {
    const send = vi.fn((seq: number) => seq !== 3);
    const q = new TranslateQueue(send, { inflight: 1 });
    const results: Record<number, boolean> = {};
    q.request(1, (ok) => { results[1] = ok; });
    q.request(2, (ok) => { results[2] = ok; });
    expect(send).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(TRANSLATE_STALL_MS);
    expect(send).toHaveBeenCalledTimes(2);
    q.settle(2);
    q.request(3, (ok) => { results[3] = ok; });
    expect(results).toEqual({ 1: true, 2: true, 3: false });
  });

  it("drops requests cancelled before they were sent (scrolled out of view)", () => {
    const send = vi.fn((_seq: number) => true);
    const q = new TranslateQueue(send, { inflight: 1 });
    q.request(1, () => undefined);
    const cancel = q.request(2, () => undefined);
    cancel();
    q.settle(1);
    expect(send.mock.calls.map(([seq]) => seq)).toEqual([1]);
  });
});
