import { act, renderHook } from "@testing-library/react";
import { StrictMode, type ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { latencyLog, markLatency, resetLatencyForTest, startLatencyTrace } from "~/lib/latency";
import { useAutoSpeak, type UseAutoSpeakOptions } from "./use-auto-speak";
import { TtsPlaybackError } from "./use-tts-player";

function setup(over: Partial<UseAutoSpeakOptions> = {}) {
  const state = { enabled: true, idle: true };
  const queue = { push: vi.fn(), end: vi.fn() };
  const options = {
    isEnabled: () => state.enabled,
    voiceIdle: () => state.idle,
    hasVoice: () => true,
    prime: vi.fn(),
    stop: vi.fn(),
    speak: vi.fn(async () => undefined),
    onError: vi.fn(),
    speakQueue: vi.fn(() => queue),
    ...over,
  };
  const hook = renderHook(() => useAutoSpeak(options as UseAutoSpeakOptions));
  return { ...hook, options, queue, state };
}

describe("pipelined auto-read (plan R8)", () => {
  it("starts on the first complete sentence and ends with the rest", () => {
    const { result, options, queue } = setup();
    act(() => result.current.begin("a1"));
    act(() => result.current.progress("a1", "Hello"));
    expect(options.speakQueue).not.toHaveBeenCalled();
    act(() => result.current.progress("a1", "Hello there. How"));
    expect(options.speakQueue).toHaveBeenCalledTimes(1);
    expect(queue.push).toHaveBeenLastCalledWith("Hello there.");
    act(() => result.current.progress("a1", "Hello there. How are you? Fine"));
    expect(queue.push).toHaveBeenLastCalledWith("How are you?");
    act(() => { result.current.complete("a1", "Hello there. How are you? Fine", "done"); });
    expect(queue.push).toHaveBeenLastCalledWith("Fine");
    expect(queue.end).toHaveBeenCalledTimes(1);
    expect(options.speak).not.toHaveBeenCalled();
  });

  it("a reply too short for a sentence boundary falls back to the whole-reply path", () => {
    const { result, options } = setup();
    act(() => result.current.begin("a1"));
    act(() => result.current.progress("a1", "Sure"));
    act(() => { result.current.complete("a1", "Sure", "done"); });
    expect(options.speakQueue).not.toHaveBeenCalled();
    expect(options.speak).toHaveBeenCalledWith("a1", "Sure", expect.any(Function));
  });

  it("busy during streaming defers to the decision at completion", () => {
    const { result, options, state } = setup();
    act(() => result.current.begin("a1"));
    state.idle = false;
    act(() => result.current.progress("a1", "One. Two"));
    expect(options.speakQueue).not.toHaveBeenCalled();
    state.idle = true;
    act(() => { result.current.complete("a1", "One. Two", "done"); });
    expect(options.speak).toHaveBeenCalledTimes(1);
  });

  it("an error mid-stream stops the queue", () => {
    const { result, options, queue } = setup();
    act(() => result.current.begin("a1"));
    act(() => result.current.progress("a1", "One. Two"));
    act(() => { result.current.complete("a1", "", "error"); });
    expect(options.stop).toHaveBeenCalled();
    expect(queue.end).not.toHaveBeenCalled();
  });

  it("code fences disable pipelining for that reply", () => {
    const { result, options } = setup();
    act(() => result.current.begin("a1"));
    act(() => result.current.progress("a1", "Look. ```js\nx()\n``` Done. More"));
    act(() => { result.current.complete("a1", "Look. ```js\nx()\n``` Done. More", "done"); });
    expect(options.speakQueue).not.toHaveBeenCalled();
    expect(options.speak).toHaveBeenCalledTimes(1);
  });

  it("ignores progress for a stale reply and without speakQueue", () => {
    const { result, options } = setup();
    act(() => result.current.begin("a2"));
    act(() => result.current.progress("a1", "One. Two"));
    expect(options.speakQueue).not.toHaveBeenCalled();
    const plain = setup({ speakQueue: undefined });
    act(() => plain.result.current.begin("a1"));
    expect(() => act(() => plain.result.current.progress("a1", "One. Two"))).not.toThrow();
  });

  it("a disabled switch never opens a queue", () => {
    const { result, options, state } = setup();
    state.enabled = false;
    act(() => result.current.begin("a1"));
    act(() => result.current.progress("a1", "One. Two"));
    act(() => { result.current.complete("a1", "One. Two", "done"); });
    expect(options.speakQueue).not.toHaveBeenCalled();
    expect(options.speak).not.toHaveBeenCalled();
  });
});

describe("pipelined auto-read: skip matrix, interruptions and contracts", () => {
  afterEach(() => vi.restoreAllMocks());

  it("hidden document at the first sentence: nothing queued, and the reply key is consumed", () => {
    const { result, options } = setup();
    const hidden = vi.spyOn(document, "hidden", "get").mockReturnValue(true);
    act(() => result.current.begin("a1"));
    act(() => result.current.progress("a1", "One. Two. Three"));
    expect(options.speakQueue).not.toHaveBeenCalled();
    let decision = "";
    act(() => { decision = result.current.complete("a1", "One. Two. Three", "done"); });
    expect(decision).toBe("hidden");
    hidden.mockReturnValue(false);
    act(() => { decision = result.current.complete("a1", "One. Two. Three", "done"); });
    expect(decision).toBe("already-read"); // 跳过就是跳过,条件恢复后也不补读
    expect(options.speakQueue).not.toHaveBeenCalled();
    expect(options.speak).not.toHaveBeenCalled();
  });

  it("recording active throughout: nothing queued, and the reply key is consumed", () => {
    const { result, options, state } = setup();
    state.idle = false;
    act(() => result.current.begin("a1"));
    act(() => result.current.progress("a1", "One. Two. Three"));
    let decision = "";
    act(() => { decision = result.current.complete("a1", "One. Two. Three", "done"); });
    expect(decision).toBe("busy");
    state.idle = true;
    act(() => { decision = result.current.complete("a1", "One. Two. Three", "done"); });
    expect(decision).toBe("already-read");
    expect(options.speakQueue).not.toHaveBeenCalled();
    expect(options.speak).not.toHaveBeenCalled();
  });

  it("auto-speak off: nothing queued, and turning it on later does not read the reply", () => {
    const { result, options, state } = setup();
    state.enabled = false;
    act(() => result.current.begin("a1"));
    act(() => result.current.progress("a1", "One. Two"));
    act(() => { result.current.complete("a1", "One. Two", "done"); });
    state.enabled = true;
    let decision = "";
    act(() => { decision = result.current.complete("a1", "One. Two", "done"); });
    expect(decision).toBe("already-read");
    expect(options.speakQueue).not.toHaveBeenCalled();
    expect(options.speak).not.toHaveBeenCalled();
  });

  it("once queued the reply key is consumed: completion does not read it again", () => {
    const { result, options, queue } = setup();
    act(() => result.current.begin("a1"));
    act(() => result.current.progress("a1", "One. Two"));
    let decision = "";
    act(() => { decision = result.current.complete("a1", "One. Two", "done"); });
    expect(decision).toBe("speak");
    act(() => { decision = result.current.complete("a1", "One. Two", "done"); });
    expect(decision).toBe("already-read");
    expect(options.speakQueue).toHaveBeenCalledTimes(1);
    expect(options.speak).not.toHaveBeenCalled();
    expect(queue.end).toHaveBeenCalledTimes(1);
    expect(queue.push.mock.calls.map((c) => c[0])).toEqual(["One.", "Two"]);
  });

  it("a non-final 'streaming' completion leaves the queue running", () => {
    const { result, options, queue } = setup();
    act(() => result.current.begin("a1"));
    act(() => result.current.progress("a1", "One. Two"));
    act(() => { result.current.complete("a1", "One. Two. Three", "streaming"); });
    expect(options.stop).not.toHaveBeenCalled();
    expect(queue.end).not.toHaveBeenCalled();
    act(() => { result.current.complete("a1", "One. Two. Three", "done"); });
    expect(queue.push.mock.calls.map((c) => c[0])).toEqual(["One.", "Two.", "Three"]);
    expect(queue.end).toHaveBeenCalledTimes(1);
  });

  it("a code block that starts after the queue opened is not read; text after it still is", () => {
    const { result, options, queue } = setup();
    act(() => result.current.begin("a1"));
    act(() => result.current.progress("a1", "Look at this. Here"));
    act(() => result.current.progress("a1", "Look at this. Here it is: ```js\nx(); y. Z()"));
    act(() => result.current.progress("a1", "Look at this. Here it is: ```js\nx(); y. Z()\n```\nThat works. Try"));
    const full = "Look at this. Here it is: ```js\nx(); y. Z()\n```\nThat works. Try it.";
    act(() => { result.current.complete("a1", full, "done"); });
    const pushed = queue.push.mock.calls.map((c) => c[0] as string);
    expect(pushed.join(" ")).not.toMatch(/x\(\)|Z\(\)|```/);
    expect(pushed).toEqual(["Look at this.", "Here it is:", "That works.", "Try it."]);
    expect(queue.end).toHaveBeenCalledTimes(1);
    expect(options.speak).not.toHaveBeenCalled();
  });

  it("a fence arriving one backtick at a time never re-reads earlier sentences", () => {
    const { result, queue } = setup();
    act(() => result.current.begin("a1"));
    for (const full of ["One. Two", "One. Two. `", "One. Two. ``", "One. Two. ```py\nx = 1. Y", "One. Two. ```py\nx = 1. Y\n```\nThree. Four"]) {
      act(() => result.current.progress("a1", full));
    }
    act(() => { result.current.complete("a1", "One. Two. ```py\nx = 1. Y\n```\nThree. Four.", "done"); });
    expect(queue.push.mock.calls.map((c) => c[0])).toEqual(["One.", "Two.", "Three.", "Four."]);
  });

  it("a reply superseded by a new send is not continued by its late completion", () => {
    const { result, queue } = setup();
    act(() => result.current.begin("a1"));
    act(() => result.current.progress("a1", "One. Two"));
    act(() => result.current.begin("a2")); // 新的 send():prime() 已清空队列
    act(() => { result.current.complete("a1", "One. Two", "done"); });
    expect(queue.push.mock.calls.map((c) => c[0])).toEqual(["One."]);
    expect(queue.end).not.toHaveBeenCalled();
  });

  it("reset() forgets the pipeline of the previous conversation", () => {
    const { result, options, queue } = setup();
    act(() => result.current.begin("a1"));
    act(() => result.current.progress("a1", "One. Two"));
    act(() => result.current.reset());
    act(() => result.current.begin("a1"));
    act(() => result.current.progress("a1", "Fresh start. Next"));
    expect(options.speakQueue).toHaveBeenCalledTimes(2);
    expect(queue.push).toHaveBeenLastCalledWith("Fresh start.");
  });

  it("a queue failure is reported once per conversation", () => {
    const failures: Array<(err: unknown) => void> = [];
    const queue = { push: vi.fn(), end: vi.fn() };
    const speakQueue = vi.fn((_key: string, onError: (err: unknown) => void) => { failures.push(onError); return queue; });
    const { result, options } = setup({ speakQueue });
    act(() => result.current.begin("a1"));
    act(() => result.current.progress("a1", "One. Two"));
    act(() => failures[0](new Error("tts down")));
    act(() => failures[0](new Error("tts down again")));
    expect(options.onError).toHaveBeenCalledTimes(1);
  });

  it("autoplay blocked mid-stream: the tap-to-read bar carries the whole reply", () => {
    const failures: Array<(err: unknown) => void> = [];
    const queue = { push: vi.fn(), end: vi.fn() };
    const speakQueue = vi.fn((_key: string, onError: (err: unknown) => void) => { failures.push(onError); return queue; });
    const { result, options } = setup({ speakQueue });
    const blocked = () => new TtsPlaybackError(new DOMException("blocked", "NotAllowedError"));
    act(() => result.current.begin("a1"));
    act(() => result.current.progress("a1", "One. Two"));
    act(() => failures[0](blocked()));
    expect(result.current.blocked).toEqual({ key: "a1", text: "One. Two" });
    act(() => { result.current.complete("a1", "One. Two. Three.", "done"); });
    expect(result.current.blocked).toEqual({ key: "a1", text: "One. Two. Three." });
    expect(options.onError).not.toHaveBeenCalled();
    act(() => result.current.tapToRead());
    expect(options.speak).toHaveBeenCalledWith("a1", "One. Two. Three.", expect.any(Function));
  });

  it("autoplay blocked after completion: the bar still carries the whole reply", () => {
    const failures: Array<(err: unknown) => void> = [];
    const queue = { push: vi.fn(), end: vi.fn() };
    const speakQueue = vi.fn((_key: string, onError: (err: unknown) => void) => { failures.push(onError); return queue; });
    const { result } = setup({ speakQueue });
    act(() => result.current.begin("a1"));
    act(() => result.current.progress("a1", "One. Two"));
    act(() => { result.current.complete("a1", "One. Two. Three.", "done"); });
    act(() => failures[0](new TtsPlaybackError(new DOMException("blocked", "NotAllowedError"))));
    expect(result.current.blocked).toEqual({ key: "a1", text: "One. Two. Three." });
  });

  it("after unmount progress is a no-op and late failures neither report nor set state", () => {
    const failures: Array<(err: unknown) => void> = [];
    const queue = { push: vi.fn(), end: vi.fn() };
    const speakQueue = vi.fn((_key: string, onError: (err: unknown) => void) => { failures.push(onError); return queue; });
    const consoleError = vi.spyOn(console, "error");
    const { result, options, unmount } = setup({ speakQueue });
    act(() => result.current.begin("a1"));
    act(() => result.current.progress("a1", "One. Two"));
    unmount();
    result.current.progress("a1", "One. Two. Three. Four");
    failures[0](new TtsPlaybackError(new DOMException("blocked", "NotAllowedError")));
    failures[0](new Error("tts down"));
    expect(queue.push).toHaveBeenCalledTimes(1);
    expect(options.onError).not.toHaveBeenCalled();
    expect(consoleError).not.toHaveBeenCalled();
  });

  it("progress keeps a stable reference", () => {
    const { result, rerender } = setup();
    const before = result.current.progress;
    act(() => result.current.begin("a1"));
    act(() => result.current.progress("a1", "One. Two"));
    rerender();
    expect(result.current.progress).toBe(before);
  });

  it("is StrictMode safe: one queue, each sentence pushed once", () => {
    const queue = { push: vi.fn(), end: vi.fn() };
    const speakQueue = vi.fn(() => queue);
    const options = { isEnabled: () => true, voiceIdle: () => true, hasVoice: () => true, prime: vi.fn(), stop: vi.fn(), speak: vi.fn(async () => undefined), onError: vi.fn(), speakQueue };
    const wrapper = ({ children }: { children: ReactNode }) => <StrictMode>{children}</StrictMode>;
    const { result } = renderHook(() => useAutoSpeak(options), { wrapper });
    act(() => result.current.begin("a1"));
    act(() => result.current.progress("a1", "One. Two"));
    act(() => result.current.progress("a1", "One. Two. Three"));
    act(() => { result.current.complete("a1", "One. Two. Three", "done"); });
    expect(speakQueue).toHaveBeenCalledTimes(1);
    expect(queue.push.mock.calls.map((c) => c[0])).toEqual(["One.", "Two.", "Three"]);
    expect(options.speak).not.toHaveBeenCalled();
  });

  describe("latency trace", () => {
    beforeEach(() => resetLatencyForTest());

    it("a pipelined reply keeps the trace open for first_audio and still marks reply_done", () => {
      const { result } = setup();
      startLatencyTrace("text");
      markLatency("reply_first_delta");
      act(() => result.current.begin("a1"));
      act(() => result.current.progress("a1", "One. Two"));
      act(() => { result.current.complete("a1", "One. Two", "done"); });
      expect(latencyLog()).toHaveLength(0);
      markLatency("first_audio");
      expect(latencyLog()[0]).toMatchObject({ status: "complete" });
      expect(latencyLog()[0].marks.reply_done).toBeDefined();
    });

    it("a reply error after the queue opened aborts the trace", () => {
      const { result } = setup();
      startLatencyTrace("text");
      markLatency("reply_first_delta");
      act(() => result.current.begin("a1"));
      act(() => result.current.progress("a1", "One. Two"));
      act(() => { result.current.complete("a1", "", "error"); });
      expect(latencyLog().map((r) => r.status)).toEqual(["aborted"]);
    });
  });
});
