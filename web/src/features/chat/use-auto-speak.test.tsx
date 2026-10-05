import { act, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { TtsPlaybackError } from "./use-tts-player";
import { autoSpeakDecision, isAutoplayBlocked, useAutoSpeak, type AutoSpeakCheck, type UseAutoSpeakOptions } from "./use-auto-speak";

const OK: AutoSpeakCheck = { enabled: true, status: "done", stale: false, alreadyRead: false, voiceIdle: true, hidden: false, hasVoice: true, text: "Hello there." };
const blockedError = () => new TtsPlaybackError(new DOMException("blocked", "NotAllowedError"));

function setup(over: Partial<UseAutoSpeakOptions> = {}) {
  const state = { enabled: true, idle: true, voice: true };
  const failures: Array<(err: unknown) => void> = [];
  const defaults = {
    isEnabled: () => state.enabled,
    voiceIdle: () => state.idle,
    hasVoice: () => state.voice,
    prime: vi.fn(),
    stop: vi.fn(),
    speak: vi.fn(async (_key: string, _text: string, onError: (err: unknown) => void) => { failures.push(onError); }),
    onError: vi.fn(),
  };
  // 覆盖项在测试里只替换成 vi.fn(),保留默认值的 Mock 类型以便断言
  const options = { ...defaults, ...over } as typeof defaults;
  const hook = renderHook(() => useAutoSpeak(options));
  return { ...hook, options, state, failures };
}

afterEach(() => vi.restoreAllMocks());

describe("autoSpeakDecision (R4)", () => {
  it.each<[Partial<AutoSpeakCheck>, string]>([
    [{}, "speak"],
    [{ enabled: false }, "disabled"],
    [{ status: "error" }, "not-done"],
    [{ status: "streaming" }, "not-done"],
    [{ stale: true }, "stale"],
    [{ alreadyRead: true }, "already-read"],
    [{ voiceIdle: false }, "busy"],
    [{ hidden: true }, "hidden"],
    [{ hasVoice: false }, "no-voice"],
    [{ text: "```js\nx()\n```" }, "empty"],
    [{ text: "   " }, "empty"],
    [{ enabled: false, status: "error", hidden: true }, "disabled"], // 按顺序取第一条
    [{ stale: true, voiceIdle: false }, "stale"],
    [{ status: "error", stale: true }, "not-done"],
    [{ alreadyRead: true, voiceIdle: false }, "already-read"],
    [{ voiceIdle: false, hidden: true }, "busy"],
    [{ hidden: true, hasVoice: false }, "hidden"],
    [{ hasVoice: false, text: "" }, "no-voice"],
  ])("%o → %s", (change, expected) => {
    expect(autoSpeakDecision({ ...OK, ...change })).toBe(expected);
  });

  it("recognizes a blocked autoplay", () => {
    expect(isAutoplayBlocked(blockedError())).toBe(true);
    expect(isAutoplayBlocked(new DOMException("x", "NotAllowedError"))).toBe(true);
    expect(isAutoplayBlocked(new TtsPlaybackError(new Error("decode")))).toBe(false);
    expect(isAutoplayBlocked(new TtsPlaybackError())).toBe(false);
    expect(isAutoplayBlocked(new Error("Upstream unavailable"))).toBe(false);
    expect(isAutoplayBlocked(null)).toBe(false);
    expect(isAutoplayBlocked("NotAllowedError")).toBe(false);
  });
});

describe("useAutoSpeak", () => {
  it("prime stops the current reading and unlocks the player, only when enabled", () => {
    const { result, options, state } = setup();
    act(() => result.current.prime());
    expect(options.stop).toHaveBeenCalledTimes(1);
    expect(options.prime).toHaveBeenCalledTimes(1);
    expect(options.stop.mock.invocationCallOrder[0]).toBeLessThan(options.prime.mock.invocationCallOrder[0]);
    state.enabled = false;
    act(() => result.current.prime());
    expect(options.prime).toHaveBeenCalledTimes(1); // 关闭时不打断用户的手动朗读
    expect(options.stop).toHaveBeenCalledTimes(1);
  });

  it("reads the newest finished reply once", () => {
    const { result, options } = setup();
    act(() => result.current.begin("a1"));
    expect(result.current.complete("a1", "Hi there.", "done")).toBe("speak");
    expect(options.speak).toHaveBeenCalledWith("a1", "Hi there.", expect.any(Function));
    expect(result.current.complete("a1", "Hi there.", "done")).toBe("already-read");
    expect(options.speak).toHaveBeenCalledTimes(1);
  });

  it("skips a reply that a newer send made stale, errors and replies that were never begun", () => {
    const { result, options } = setup();
    act(() => { result.current.begin("a1"); result.current.begin("a2"); });
    expect(result.current.complete("a1", "Old.", "done")).toBe("stale");
    expect(result.current.complete("a2", "New.", "error")).toBe("not-done");
    expect(result.current.complete("history", "Loaded.", "done")).toBe("stale");
    expect(options.speak).not.toHaveBeenCalled();
  });

  it("does not read anything before a send", () => {
    const { result, options } = setup();
    expect(result.current.complete("a1", "Hi.", "done")).toBe("stale");
    expect(options.speak).not.toHaveBeenCalled();
  });

  it("respects the switch, the microphone, the voice model and a hidden page", () => {
    const { result, options, state } = setup();
    act(() => result.current.begin("a1"));
    state.enabled = false;
    expect(result.current.complete("a1", "x.", "done")).toBe("disabled");
    state.enabled = true;
    state.idle = false;
    expect(result.current.complete("a1", "x.", "done")).toBe("busy");
    state.idle = true;
    state.voice = false;
    expect(result.current.complete("a1", "x.", "done")).toBe("no-voice");
    state.voice = true;
    vi.spyOn(document, "hidden", "get").mockReturnValue(true);
    expect(result.current.complete("a1", "x.", "done")).toBe("hidden");
    expect(options.speak).not.toHaveBeenCalled();
  });

  it("reads the options at call time (toggle off after begin, on again later)", () => {
    const { result, options, state } = setup();
    act(() => result.current.begin("a1"));
    state.enabled = false;
    expect(result.current.complete("a1", "x.", "done")).toBe("disabled");
    act(() => result.current.begin("a2"));
    state.enabled = true;
    expect(result.current.complete("a2", "y.", "done")).toBe("speak");
    expect(options.speak).toHaveBeenCalledTimes(1);
    expect(options.speak).toHaveBeenCalledWith("a2", "y.", expect.any(Function));
  });

  it("a skipped reply is not marked as read", () => {
    const { result, options, state } = setup();
    act(() => result.current.begin("a1"));
    state.idle = false; // 录音中
    expect(result.current.complete("a1", "x.", "done")).toBe("busy");
    state.idle = true;
    expect(result.current.complete("a1", "x.", "done")).toBe("speak");
    expect(options.speak).toHaveBeenCalledTimes(1);
  });

  it("skips a reply with nothing speakable without calling speak", () => {
    const { result, options } = setup();
    act(() => result.current.begin("a1"));
    expect(result.current.complete("a1", "```js\nx()\n```", "done")).toBe("empty");
    expect(options.speak).not.toHaveBeenCalled();
  });

  it("uses the latest options passed on re-render", () => {
    const first = vi.fn(async () => {});
    const second = vi.fn(async () => {});
    const base = { isEnabled: () => true, voiceIdle: () => true, hasVoice: () => true, prime: vi.fn(), stop: vi.fn(), onError: vi.fn() };
    const { result, rerender } = renderHook((props: { speak: UseAutoSpeakOptions["speak"] }) => useAutoSpeak({ ...base, speak: props.speak }), { initialProps: { speak: first } });
    rerender({ speak: second });
    act(() => result.current.begin("a1"));
    result.current.complete("a1", "Hi.", "done");
    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledTimes(1);
  });

  it("keeps every callback reference stable across renders", () => {
    const { result, rerender, failures } = setup();
    const before = result.current;
    act(() => result.current.begin("a1"));
    result.current.complete("a1", "x.", "done");
    act(() => failures[0](blockedError())); // 触发一次 state 变化
    rerender();
    const after = result.current;
    for (const name of ["prime", "begin", "complete", "speakOpening", "reset", "tapToRead", "dismissBlocked"] as const) {
      expect(after[name]).toBe(before[name]);
    }
  });

  it("shows the tap-to-read hint once when autoplay is blocked; the tap plays that reply", () => {
    const { result, options, failures } = setup();
    act(() => result.current.begin("a1"));
    result.current.complete("a1", "First.", "done");
    act(() => failures[0](blockedError()));
    expect(result.current.blocked).toEqual({ key: "a1", text: "First." });
    expect(options.onError).not.toHaveBeenCalled();
    act(() => result.current.tapToRead());
    expect(options.speak).toHaveBeenLastCalledWith("a1", "First.", expect.any(Function));
    expect(result.current.blocked).toBeNull();
    act(() => result.current.begin("a2"));
    result.current.complete("a2", "Second.", "done");
    act(() => failures.at(-1)!(blockedError()));
    expect(result.current.blocked).toBeNull(); // 同一会话只提示一次
  });

  it("a double tap reads the blocked reply only once", () => {
    const { result, options, failures } = setup();
    act(() => result.current.begin("a1"));
    result.current.complete("a1", "First.", "done");
    act(() => failures[0](blockedError()));
    act(() => { result.current.tapToRead(); result.current.tapToRead(); });
    expect(options.speak).toHaveBeenCalledTimes(2);
  });

  it("dismissing the hint clears it without playing", () => {
    const { result, options, failures } = setup();
    act(() => result.current.begin("a1"));
    result.current.complete("a1", "First.", "done");
    act(() => failures[0](blockedError()));
    act(() => result.current.dismissBlocked());
    expect(result.current.blocked).toBeNull();
    act(() => result.current.tapToRead()); // 没有目标时什么都不做
    expect(options.speak).toHaveBeenCalledTimes(1);
  });

  it("a failure of the tap-to-read playback is reported once like any other", () => {
    const { result, options, failures } = setup();
    act(() => result.current.begin("a1"));
    result.current.complete("a1", "First.", "done");
    act(() => failures[0](blockedError()));
    act(() => result.current.tapToRead());
    act(() => failures.at(-1)!(new Error("Upstream unavailable")));
    expect(options.onError).toHaveBeenCalledTimes(1);
    expect(result.current.blocked).toBeNull();
  });

  it("reports other failures at most once per conversation", () => {
    const { result, options, failures } = setup();
    for (const key of ["a1", "a2"]) {
      act(() => result.current.begin(key));
      result.current.complete(key, "Text.", "done");
      act(() => failures.at(-1)!(new Error("Upstream unavailable")));
    }
    expect(options.onError).toHaveBeenCalledTimes(1);
    act(() => result.current.reset());
    act(() => result.current.begin("b1"));
    result.current.complete("b1", "Text.", "done");
    act(() => failures.at(-1)!(new Error("Upstream unavailable")));
    expect(options.onError).toHaveBeenCalledTimes(2); // 换会话后重新计
  });

  it("a rejected speak() counts as a failure instead of an unhandled rejection", async () => {
    const { result, options } = setup({ speak: vi.fn(() => Promise.reject(new Error("boom"))) });
    act(() => result.current.begin("a1"));
    result.current.complete("a1", "Text.", "done");
    await act(async () => {});
    expect(options.onError).toHaveBeenCalledWith(expect.objectContaining({ message: "boom" }));
  });

  it("reset makes pending replies stale and ignores late errors from before", () => {
    const { result, options, failures } = setup();
    act(() => result.current.begin("a1"));
    result.current.complete("a1", "Text.", "done");
    act(() => result.current.reset());
    act(() => failures[0](new Error("late")));
    act(() => failures[0](blockedError()));
    expect(options.onError).not.toHaveBeenCalled();
    expect(result.current.blocked).toBeNull();
    expect(result.current.complete("a1", "Text.", "done")).toBe("stale");
  });

  it("switching conversations clears the hint, re-arms it and forgets which replies were read", () => {
    const { result, options, failures } = setup();
    act(() => result.current.begin("a1"));
    result.current.complete("a1", "First.", "done");
    act(() => failures[0](blockedError()));
    expect(result.current.blocked).not.toBeNull();
    act(() => result.current.reset());
    expect(result.current.blocked).toBeNull();
    act(() => result.current.begin("a1")); // 同一 key 在新会话里可以再读
    expect(result.current.complete("a1", "First.", "done")).toBe("speak");
    act(() => failures.at(-1)!(blockedError()));
    expect(result.current.blocked).toEqual({ key: "a1", text: "First." });
    expect(options.speak).toHaveBeenCalledTimes(2);
  });

  it("reads an opening line only before the user sends anything", () => {
    const { result, options } = setup();
    expect(result.current.speakOpening("m0", "Welcome!")).toBe("speak");
    expect(result.current.speakOpening("m0", "Welcome!")).toBe("already-read");
    act(() => result.current.begin("a1"));
    expect(result.current.speakOpening("m9", "Late.")).toBe("stale");
    expect(options.speak).toHaveBeenCalledTimes(1);
  });

  it("an opening line obeys the switch, a hidden page and the microphone", () => {
    const { result, options, state } = setup();
    state.enabled = false;
    expect(result.current.speakOpening("m0", "Welcome!")).toBe("disabled");
    state.enabled = true;
    state.idle = false;
    expect(result.current.speakOpening("m0", "Welcome!")).toBe("busy");
    state.idle = true;
    vi.spyOn(document, "hidden", "get").mockReturnValue(true);
    expect(result.current.speakOpening("m0", "Welcome!")).toBe("hidden");
    expect(options.speak).not.toHaveBeenCalled();
  });

  it("does nothing after unmount", () => {
    const { result, options, failures, unmount } = setup();
    const errorSpy = vi.spyOn(console, "error");
    act(() => result.current.begin("a1"));
    result.current.complete("a1", "Text.", "done");
    const api = result.current;
    unmount();
    failures[0](new Error("late"));
    failures[0](blockedError());
    expect(options.onError).not.toHaveBeenCalled();
    expect(api.complete("a1", "Text.", "done")).toBe("stale"); // 卸载后 begin 的回复过期
    expect(api.speakOpening("m0", "Welcome!")).toBe("stale");
    api.reset();
    api.tapToRead();
    api.dismissBlocked();
    expect(options.speak).toHaveBeenCalledTimes(1);
    expect(errorSpy).not.toHaveBeenCalled();
  });

  it("never touches the audio element itself: it only drives the player it was given", () => {
    // 契约:prime/stop/speak 必须来自同一个独占 sharedAutoplayAudio 的 useTtsPlayer;
    // 本 hook 只调用传入的函数,不会自己去停/改共享元素。
    const { result, options } = setup();
    act(() => result.current.begin("a1"));
    result.current.complete("a1", "Hi.", "done");
    act(() => result.current.reset());
    expect(options.stop).not.toHaveBeenCalled(); // reset 不替调用方停止:切换会话时由页面调用 player.stop()
    expect(options.prime).not.toHaveBeenCalled();
  });
});
