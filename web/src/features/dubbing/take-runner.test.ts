import { describe, expect, it, vi } from "vitest";
import type { DubbingTake, LineResult } from "./dubbing-api";
import type { LineClip } from "./take-capture";
import { createTakeRunner, type TakeRunnerDeps } from "./take-runner";
import type { LineWindow } from "./windows";

const WINDOWS: LineWindow[] = [{ idx: 0, startMs: 0, endMs: 1000, lineStartMs: 300, lineEndMs: 900 }];
const LINE: LineResult = { segIdx: 0, pronunciation: 90, fluency: 80, sync: 70, syncBasis: "words", score: 84 };
const clip = (idx: number): LineClip => ({
  idx, recStartMs: 0, capture: "pcm", noSpeech: false, voicedMs: 400, durationMs: 1000, wav: new Blob(["w"], { type: "audio/wav" }),
});

function fixture(over: Partial<TakeRunnerDeps> = {}) {
  const order: string[] = [];
  const capture = {
    mode: "pcm" as const,
    ready: Promise.resolve(),
    open: vi.fn(),
    close: vi.fn((idx: number) => clip(idx)),
    finish: vi.fn(async () => []),
    release: vi.fn(),
  };
  const scheduler = { start: vi.fn(() => order.push("play")), destroy: vi.fn() };
  let schedOpts: Parameters<TakeRunnerDeps["createScheduler"]>[0] | null = null;
  const deps: TakeRunnerDeps = {
    startCapture: vi.fn((_ms: number, _onInt: () => void) => { order.push("capture"); return capture; }),
    createScheduler: vi.fn((opts) => { schedOpts = opts; return scheduler; }),
    createTake: vi.fn(async () => { order.push("createTake"); return { id: "dub-1" } as DubbingTake; }),
    finishTake: vi.fn(async () => ({ id: "dub-1", status: "done" }) as DubbingTake),
    assess: vi.fn(async () => ({ assessmentId: "a-9" })),
    post: vi.fn(async () => LINE),
    claim: vi.fn(),
    release: vi.fn(),
    createObjectURL: vi.fn((b: Blob) => `blob:${b.size}-${Math.random()}`),
    revokeObjectURL: vi.fn(),
    now: () => 0,
    ...over,
  };
  const runner = createTakeRunner({ windows: WINDOWS, clipStartMs: 0, clipEndMs: 1000, deps });
  return { runner, deps, capture, scheduler, order, sched: () => schedOpts! };
}

describe("take runner (plan L5 W6)", () => {
  it("start opens the microphone and starts playback before it creates the take", () => {
    const { runner, order } = fixture();
    runner.start();
    expect(order.slice(0, 2)).toEqual(["capture", "play"]);
    expect(runner.state()).toBe("starting");
  });

  it("is recording once the take exists", async () => {
    const { runner } = fixture();
    runner.start();
    await vi.waitFor(() => expect(runner.state()).toBe("recording"));
  });

  it("if the take cannot be created it releases the microphone, stops playback and shows an error", async () => {
    const { runner, deps, capture, scheduler } = fixture({ createTake: vi.fn(async () => { throw new Error("nope"); }) });
    runner.start();
    await vi.waitFor(() => expect(runner.state()).toBe("error"));
    expect(capture.release).toHaveBeenCalled();
    expect(scheduler.destroy).toHaveBeenCalled();
    expect(deps.release).toHaveBeenCalled();
  });

  it("a full take: windows are cut as they close, scored, drained, and finished", async () => {
    const { runner, deps, capture, sched } = fixture();
    runner.start();
    await vi.waitFor(() => expect(runner.state()).toBe("recording"));
    sched().onOpen(0, 300);
    sched().onClose(0, 900);
    expect(capture.close).toHaveBeenCalledWith(0, 900);
    sched().onEnd();
    const result = await vi.waitFor(() => {
      expect(runner.state()).toBe("done");
      return runner.result();
    });
    expect(deps.assess).toHaveBeenCalledTimes(1);
    expect(deps.post).toHaveBeenCalledWith("dub-1", expect.objectContaining({ idx: 0 }), "a-9", expect.any(AbortSignal));
    expect(deps.finishTake).toHaveBeenCalledWith("dub-1");
    expect(result?.outcomes).toEqual([{ idx: 0, status: "scored", line: LINE }]);
    expect(result?.urls.get(0)).toMatch(/^blob:/);
  });

  it("an interruption stops the take: no finish call, state interrupted, microphone released", async () => {
    const { runner, deps, capture, scheduler, sched } = fixture();
    runner.start();
    await vi.waitFor(() => expect(runner.state()).toBe("recording"));
    sched().onInterrupted();
    expect(runner.state()).toBe("interrupted");
    expect(capture.release).toHaveBeenCalled();
    expect(scheduler.destroy).toHaveBeenCalled();
    expect(deps.finishTake).not.toHaveBeenCalled();
  });

  it("dispose revokes every object URL and releases everything", async () => {
    const { runner, deps, sched, capture } = fixture();
    runner.start();
    await vi.waitFor(() => expect(runner.state()).toBe("recording"));
    sched().onOpen(0, 300);
    sched().onClose(0, 900);
    await vi.waitFor(() => expect(deps.post).toHaveBeenCalled());
    runner.dispose();
    expect(deps.revokeObjectURL).toHaveBeenCalledTimes(1);
    expect(capture.release).toHaveBeenCalled();
    expect(deps.release).toHaveBeenCalled();
  });

  it("subscribers hear every state change", async () => {
    const { runner } = fixture();
    const seen: string[] = [];
    runner.subscribe((s) => seen.push(s));
    runner.start();
    await vi.waitFor(() => expect(runner.state()).toBe("recording"));
    expect(seen).toEqual(["starting", "recording"]);
  });
});
