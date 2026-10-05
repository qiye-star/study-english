import { describe, expect, it, vi } from "vitest";
import { inflightDedupe, withSignal } from "./abortable";

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
});
