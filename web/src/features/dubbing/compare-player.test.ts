import { describe, expect, it, vi } from "vitest";
import { type ComparePlayerDeps, createComparePlayer } from "./compare-player";

function deps(): ComparePlayerDeps & { calls: string[]; endOriginal(): void; endMine(): void } {
  const calls: string[] = [];
  let endO: () => void = () => {};
  let endM: () => void = () => {};
  return {
    calls,
    claim: vi.fn(() => calls.push("claim")),
    release: vi.fn(() => calls.push("release")),
    playOriginal: vi.fn((idx: number, onEnded: () => void) => { calls.push(`original:${idx}`); endO = onEnded; }),
    stopOriginal: vi.fn(() => calls.push("stopOriginal")),
    playMine: vi.fn((url: string, onEnded: () => void) => { calls.push(`mine:${url}`); endM = onEnded; }),
    stopMine: vi.fn(() => calls.push("stopMine")),
    endOriginal: () => endO(),
    endMine: () => endM(),
  };
}

describe("compare player: original vs mine, never at the same time (plan L5 W10)", () => {
  it("playing the original claims the audio and plays the sentence once", () => {
    const d = deps();
    const p = createComparePlayer(d);
    p.original(2);
    expect(d.calls).toEqual(["claim", "original:2"]);
    expect(p.playing()).toBe("original");
  });

  it("starting 'mine' stops the original first, so they never overlap", () => {
    const d = deps();
    const p = createComparePlayer(d);
    p.original(2);
    p.mine("blob:a");
    expect(d.calls).toEqual(["claim", "original:2", "stopOriginal", "mine:blob:a"]);
    expect(p.playing()).toBe("mine");
  });

  it("rapid taps stop the previous one before the next starts", () => {
    const d = deps();
    const p = createComparePlayer(d);
    p.original(1);
    p.original(3);
    p.original(3);
    expect(d.calls.filter((c) => c === "stopOriginal")).toHaveLength(2);
    expect(d.calls.at(-1)).toBe("original:3");
  });

  it("when a clip ends on its own, the player goes idle and releases the audio", () => {
    const d = deps();
    const p = createComparePlayer(d);
    p.mine("blob:a");
    d.endMine();
    expect(p.playing()).toBe("idle");
    expect(d.release).toHaveBeenCalled();
  });

  it("stop stops whatever is playing and releases the audio", () => {
    const d = deps();
    const p = createComparePlayer(d);
    p.original(0);
    p.stop();
    expect(d.stopOriginal).toHaveBeenCalled();
    expect(p.playing()).toBe("idle");
  });

  it("another sound taking the audio focus stops the compare player", () => {
    const d = deps();
    const p = createComparePlayer(d);
    p.mine("blob:a");
    (d.claim as ReturnType<typeof vi.fn>).mock.calls[0]?.[0]?.();
    expect(p.playing()).toBe("idle");
  });
});
