import { describe, expect, it, vi } from "vitest";
import { abortableDedupe, inflightDedupe, withSignal } from "./abortable";

describe("abortable helpers", () => {
  it("shares one load per key until it settles", async () => {
    const dedupe = inflightDedupe<number>();
    let release!: (v: number) => void;
    const load = vi.fn(() => new Promise<number>((r) => (release = r)));
    const a = dedupe("k", load);
    const b = dedupe("k", load);
    expect(load).toHaveBeenCalledTimes(1);
    release(7);
    expect(await Promise.all([a, b])).toEqual([7, 7]);
    await dedupe("k", async () => 8);
    expect(load).toHaveBeenCalledTimes(1);
  });

  it("lets one caller stop waiting without cancelling the shared promise", async () => {
    let release!: (v: string) => void;
    const shared = new Promise<string>((r) => (release = r));
    const controller = new AbortController();
    const waiting = withSignal(shared, controller.signal);
    controller.abort();
    await expect(waiting).rejects.toMatchObject({ name: "AbortError" });
    release("done");
    expect(await withSignal(shared)).toBe("done");
  });
  it("aborts the shared load only when every waiter has left, and starts fresh afterwards", async () => {
    const dedupe = abortableDedupe<number>();
    const signals: AbortSignal[] = [];
    const load = vi.fn((signal: AbortSignal) => new Promise<number>((resolve, reject) => {
      signals.push(signal);
      signal.addEventListener("abort", () => reject(new Error("load aborted")));
      if (signals.length > 1) resolve(9);
    }));
    const one = new AbortController();
    const two = new AbortController();
    const a = dedupe("k", load, one.signal);
    const b = dedupe("k", load, two.signal);
    expect(load).toHaveBeenCalledTimes(1);
    one.abort();
    await expect(a).rejects.toMatchObject({ name: "AbortError" });
    expect(signals[0].aborted).toBe(false);
    two.abort();
    await expect(b).rejects.toMatchObject({ name: "AbortError" });
    expect(signals[0].aborted).toBe(true);
    expect(await dedupe("k", load, new AbortController().signal)).toBe(9);
    expect(load).toHaveBeenCalledTimes(2);
  });

  it("never aborts a load that has a waiter without a signal", async () => {
    const dedupe = abortableDedupe<number>();
    let seen!: AbortSignal;
    let release!: (v: number) => void;
    const load = (signal: AbortSignal) => { seen = signal; return new Promise<number>((r) => (release = r)); };
    const keep = dedupe("k", load);
    const leave = new AbortController();
    const gone = dedupe("k", load, leave.signal);
    leave.abort();
    await expect(gone).rejects.toMatchObject({ name: "AbortError" });
    expect(seen.aborted).toBe(false);
    release(3);
    expect(await keep).toBe(3);
  });
});
