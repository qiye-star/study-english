import { act, renderHook } from "@testing-library/react";
import { StrictMode, type ReactNode } from "react";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { ApiClient } from "~/api/client";
import { latencyLog, markLatency, resetLatencyForTest, startLatencyTrace } from "~/lib/latency";
import { resetPlaybackRateForTests, setPlaybackRate } from "~/lib/playback-rate";
import { createFetchMock, json } from "~/test/fetch-mock";
import { claimAudio } from "~/audio/audio-focus";
import { TtsCache } from "./tts";
import { TtsPlaybackError, useTtsPlayer } from "./use-tts-player";

function fakeAudio() {
  return { src: "", play: vi.fn(() => Promise.resolve()), pause: vi.fn(), onended: null as null | (() => void), onerror: null } as unknown as HTMLAudioElement & { onended: () => void };
}
let n = 0;
const mkCache = () => new TtsCache(20, { create: () => `blob:${++n}`, revoke: () => undefined });
const inputs = (mock: ReturnType<typeof createFetchMock>) =>
  mock.calls.filter((c) => c.url.pathname === "/api/ai/audio/speech").map((c) => JSON.parse(String(c.body)).input as string);
const flush = () => act(async () => { await new Promise((r) => setTimeout(r, 0)); });
const okSpeech = () => createFetchMock({ "POST /api/ai/audio/speech": () => new Response(new Uint8Array([1])) });
const apiFor = (mock: ReturnType<typeof createFetchMock>) => new ApiClient({ getToken: () => "t", fetchImpl: mock.fetch });

beforeAll(() => {
  Object.assign(URL, { createObjectURL: vi.fn(() => "blob:silent"), revokeObjectURL: vi.fn() });
});

describe("useTtsPlayer.playQueue (plan R8)", () => {
  it("plays sentences in order, prefetching at most two", async () => {
    const mock = createFetchMock({ "POST /api/ai/audio/speech": () => new Response(new Uint8Array([1])) });
    const audio = fakeAudio();
    const { result } = renderHook(() => useTtsPlayer(new ApiClient({ getToken: () => "t", fetchImpl: mock.fetch }), { cache: mkCache(), createAudio: () => audio }));
    let q!: ReturnType<typeof result.current.playQueue>;
    act(() => { q = result.current.playQueue("a1", "m", "v"); });
    expect(result.current.states.a1).toBe("loading");
    act(() => { q.push("One."); q.push("Two."); q.push("Three."); q.push("Four."); });
    await flush();
    expect(result.current.states.a1).toBe("playing");
    expect(inputs(mock)).toEqual(["One.", "Two.", "Three."]); // 正在播放 1 句 + 预取 2 句
    act(() => audio.onended());
    await flush();
    expect(inputs(mock)).toEqual(["One.", "Two.", "Three.", "Four."]);
    act(() => q.end());
    for (let i = 0; i < 3; i++) {
      act(() => audio.onended());
      await flush();
    }
    expect(result.current.states.a1).toBe("idle");
    expect(audio.play).toHaveBeenCalledTimes(4);
  });

  it("stop() clears the queue without reporting an error", async () => {
    const mock = createFetchMock({ "POST /api/ai/audio/speech": () => new Response(new Uint8Array([1])) });
    const onError = vi.fn();
    const audio = fakeAudio();
    const { result } = renderHook(() => useTtsPlayer(new ApiClient({ getToken: () => "t", fetchImpl: mock.fetch }), { cache: mkCache(), createAudio: () => audio, onError }));
    let q!: ReturnType<typeof result.current.playQueue>;
    act(() => { q = result.current.playQueue("a1", "m", "v"); q.push("One."); q.push("Two."); });
    await flush();
    act(() => result.current.stop());
    act(() => q.push("Three."));
    act(() => audio.onended?.());
    await flush();
    expect(result.current.states.a1).toBe("idle");
    expect(inputs(mock)).not.toContain("Three.");
    expect(onError).not.toHaveBeenCalled();
  });

  it("a failing sentence reports once and stops the rest", async () => {
    let call = 0;
    const mock = createFetchMock({ "POST /api/ai/audio/speech": () => (++call === 2 ? json({ error: "Upstream unavailable" }, 502) : new Response(new Uint8Array([1]))) });
    const onError = vi.fn();
    const audio = fakeAudio();
    const { result } = renderHook(() => useTtsPlayer(new ApiClient({ getToken: () => "t", fetchImpl: mock.fetch }), { cache: mkCache(), createAudio: () => audio }));
    act(() => { const q = result.current.playQueue("a1", "m", "v", { onError }); q.push("One."); q.push("Two."); q.end(); });
    await flush();
    act(() => audio.onended());
    await flush();
    expect(onError).toHaveBeenCalledTimes(1);
    expect(result.current.states.a1).toBe("error");
  });

  it("onEnd fires when the last sentence has finished playing, not when it starts; stop() also ends it; errors do not", async () => {
    const audio = fakeAudio();
    const onEnd = vi.fn();
    const { result } = renderHook(() => useTtsPlayer(apiFor(okSpeech()), { cache: mkCache(), createAudio: () => audio }));
    act(() => { const q = result.current.playQueue("a1", "m", "v", { onEnd }); q.push("One."); q.end(); });
    await flush();
    expect(audio.play).toHaveBeenCalledTimes(1);
    expect(onEnd).not.toHaveBeenCalled(); // playing, not finished
    act(() => audio.onended());
    await flush();
    expect(onEnd).toHaveBeenCalledTimes(1);

    const stopped = vi.fn();
    act(() => { const q = result.current.playQueue("a2", "m", "v", { onEnd: stopped }); q.push("Two."); q.end(); });
    await flush();
    act(() => result.current.stop());
    expect(stopped).toHaveBeenCalledTimes(1);

    const failed = vi.fn();
    const onError = vi.fn();
    (audio.play as ReturnType<typeof vi.fn>).mockImplementationOnce(() => Promise.reject(new Error("blocked")));
    act(() => { const q = result.current.playQueue("a3", "m", "v", { onEnd: failed, onError }); q.push("Three."); q.end(); });
    await flush();
    expect(onError).toHaveBeenCalledTimes(1);
    expect(failed).not.toHaveBeenCalled();
  });

  it("uses the sentence cache", async () => {
    const mock = createFetchMock({ "POST /api/ai/audio/speech": () => new Response(new Uint8Array([1])) });
    const cache = mkCache();
    const audio = fakeAudio();
    const { result } = renderHook(() => useTtsPlayer(new ApiClient({ getToken: () => "t", fetchImpl: mock.fetch }), { cache, createAudio: () => audio }));
    act(() => { const q = result.current.playQueue("a1", "m", "v"); q.push("Same."); q.end(); });
    await flush();
    act(() => audio.onended());
    await flush();
    act(() => { const q = result.current.playQueue("a2", "m", "v"); q.push("Same."); q.end(); });
    await flush();
    expect(inputs(mock)).toEqual(["Same."]);
  });
});

describe("useTtsPlayer.playQueue: interruptions and contracts", () => {
  beforeEach(() => { localStorage.clear(); resetPlaybackRateForTests(); resetLatencyForTest(); });
  afterEach(() => resetPlaybackRateForTests());

  it("synthesises the markdown-stripped sentence and keys the cache by it; code-only sentences are skipped", async () => {
    const mock = okSpeech();
    const cache = mkCache();
    const audio = fakeAudio();
    const { result } = renderHook(() => useTtsPlayer(apiFor(mock), { cache, createAudio: () => audio }));
    act(() => { const q = result.current.playQueue("a1", "m", "v"); q.push("**Bold** move."); q.push("`x()`"); q.end(); });
    await flush();
    expect(inputs(mock)).toEqual(["Bold move.", "x()"]); // 行内代码保留文字(与整条朗读的 speakableText 一致)
    act(() => { const q = result.current.playQueue("a2", "m", "v"); q.push("```js\nx()\n```"); q.end(); });
    await flush();
    expect(result.current.states.a2).toBe("idle"); // 没有可读内容:不请求,直接结束
    expect(inputs(mock)).toHaveLength(2);
    expect(cache.get("m\u0000v\u0000Bold move.")).toBeDefined();
  });

  it("end() before any sentence leaves the player idle without requests", async () => {
    const mock = okSpeech();
    const { result } = renderHook(() => useTtsPlayer(apiFor(mock), { cache: mkCache(), createAudio: fakeAudio }));
    act(() => { result.current.playQueue("a1", "m", "v").end(); });
    await flush();
    expect(result.current.states.a1).toBe("idle");
    expect(inputs(mock)).toEqual([]);
  });

  it("waits for more sentences after draining the queue until end()", async () => {
    const mock = okSpeech();
    const audio = fakeAudio();
    const { result } = renderHook(() => useTtsPlayer(apiFor(mock), { cache: mkCache(), createAudio: () => audio }));
    let q!: ReturnType<typeof result.current.playQueue>;
    act(() => { q = result.current.playQueue("a1", "m", "v"); q.push("One."); });
    await flush();
    act(() => audio.onended());
    await flush();
    expect(result.current.states.a1).toBe("playing"); // 回复还在流式生成:不提前回到 idle
    act(() => q.push("Two."));
    await flush();
    expect(audio.play).toHaveBeenCalledTimes(2);
    act(() => q.end());
    act(() => audio.onended());
    await flush();
    expect(result.current.states.a1).toBe("idle");
  });

  it("a new play() clears the queue and plays only the new text", async () => {
    const mock = okSpeech();
    const onError = vi.fn();
    const audio = fakeAudio();
    const { result } = renderHook(() => useTtsPlayer(apiFor(mock), { cache: mkCache(), createAudio: () => audio, onError }));
    let q!: ReturnType<typeof result.current.playQueue>;
    act(() => { q = result.current.playQueue("a1", "m", "v"); q.push("One."); q.push("Two."); q.push("Three."); q.push("Four."); });
    await flush();
    await act(() => result.current.play("u1", "Other text", "m", "v"));
    expect(result.current.states.a1).toBe("idle");
    expect(result.current.states.u1).toBe("playing");
    act(() => { q.push("Five."); q.end(); });
    act(() => audio.onended());
    await flush();
    expect(inputs(mock)).toEqual(["One.", "Two.", "Three.", "Other text"]);
    expect(result.current.states.u1).toBe("idle");
    expect(onError).not.toHaveBeenCalled();
  });

  it("a manual listen click on the reply being read (same key) stops the queue", async () => {
    const mock = okSpeech();
    const audio = fakeAudio();
    const { result } = renderHook(() => useTtsPlayer(apiFor(mock), { cache: mkCache(), createAudio: () => audio }));
    let q!: ReturnType<typeof result.current.playQueue>;
    act(() => { q = result.current.playQueue("a1", "m", "v"); q.push("One."); q.push("Two."); });
    await flush();
    await act(() => result.current.play("a1", "One. Two.", "m", "v"));
    expect(result.current.states.a1).toBe("idle");
    expect(audio.pause).toHaveBeenCalled();
    act(() => q.push("Three."));
    await flush();
    expect(audio.play).toHaveBeenCalledTimes(1);
    expect(inputs(mock)).toEqual(["One.", "Two."]);
  });

  it("prime() and a second playQueue() both clear the running queue", async () => {
    const mock = okSpeech();
    const audio = fakeAudio();
    const { result } = renderHook(() => useTtsPlayer(apiFor(mock), { cache: mkCache(), createAudio: () => audio }));
    let q1!: ReturnType<typeof result.current.playQueue>;
    act(() => { q1 = result.current.playQueue("a1", "m", "v"); q1.push("One."); });
    await flush();
    act(() => result.current.prime());
    expect(result.current.states.a1).toBe("idle");
    let q2!: ReturnType<typeof result.current.playQueue>;
    act(() => { q2 = result.current.playQueue("a2", "m", "v"); q2.push("Alpha."); });
    act(() => { const q3 = result.current.playQueue("a3", "m", "v"); q3.push("Beta."); q3.end(); });
    act(() => { q1.push("Two."); q2.push("Gamma."); });
    await flush();
    expect(result.current.states.a2).toBe("idle");
    expect(result.current.states.a3).toBe("playing");
    expect(inputs(mock)).not.toContain("Two.");
    expect(inputs(mock)).not.toContain("Gamma.");
    expect(audio.src).not.toBe("blob:silent"); // 正在播的是 a3 的句子,不是 prime 的静音
  });

  it("another audio claimant (recording playback) stops the queue", async () => {
    const mock = okSpeech();
    const audio = fakeAudio();
    const { result } = renderHook(() => useTtsPlayer(apiFor(mock), { cache: mkCache(), createAudio: () => audio }));
    act(() => { const q = result.current.playQueue("a1", "m", "v"); q.push("One."); });
    await flush();
    act(() => claimAudio(() => undefined));
    expect(result.current.states.a1).toBe("idle");
    expect(audio.pause).toHaveBeenCalled();
  });

  it("a blocked play() reports a TtsPlaybackError once and stops the rest", async () => {
    const mock = okSpeech();
    const onError = vi.fn();
    const audio = fakeAudio();
    (audio.play as ReturnType<typeof vi.fn>).mockImplementation(() => Promise.reject(new DOMException("blocked", "NotAllowedError")));
    const { result } = renderHook(() => useTtsPlayer(apiFor(mock), { cache: mkCache(), createAudio: () => audio, onError }));
    let q!: ReturnType<typeof result.current.playQueue>;
    act(() => { q = result.current.playQueue("a1", "m", "v"); q.push("One."); q.push("Two."); });
    await flush();
    act(() => { q.push("Three."); q.end(); });
    await flush();
    expect(onError).toHaveBeenCalledTimes(1);
    expect(onError.mock.calls[0][0]).toBeInstanceOf(TtsPlaybackError);
    expect(result.current.states.a1).toBe("error");
    expect(audio.play).toHaveBeenCalledTimes(1);
    expect(inputs(mock)).not.toContain("Three.");
  });

  it("an audio element error mid-queue reports once", async () => {
    const mock = okSpeech();
    const onError = vi.fn();
    const audio = fakeAudio();
    const { result } = renderHook(() => useTtsPlayer(apiFor(mock), { cache: mkCache(), createAudio: () => audio }));
    act(() => { const q = result.current.playQueue("a1", "m", "v", { onError }); q.push("One."); q.push("Two."); q.end(); });
    await flush();
    act(() => (audio.onerror as unknown as () => void)());
    await flush();
    expect(onError).toHaveBeenCalledTimes(1);
    expect(onError.mock.calls[0][0]).toBeInstanceOf(TtsPlaybackError);
    expect(audio.play).toHaveBeenCalledTimes(1);
    expect(audio.onended).toBeNull();
  });

  it("unmount aborts pending synthesis, pauses, and never reports or sets state", async () => {
    const signals: AbortSignal[] = [];
    const mock = createFetchMock({
      "POST /api/ai/audio/speech": (call) => {
        signals.push(call.signal as AbortSignal);
        return new Promise<Response>((_, reject) => call.signal!.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError"))));
      },
    });
    const onError = vi.fn();
    const audio = fakeAudio();
    const consoleError = vi.spyOn(console, "error");
    const { result, unmount } = renderHook(() => useTtsPlayer(apiFor(mock), { cache: mkCache(), createAudio: () => audio, onError }));
    let q!: ReturnType<typeof result.current.playQueue>;
    act(() => { q = result.current.playQueue("a1", "m", "v"); q.push("One."); q.push("Two."); });
    unmount();
    await flush();
    q.push("Three.");
    q.end();
    await flush();
    expect(signals.length).toBeGreaterThan(0);
    expect(signals.every((s) => s.aborted)).toBe(true);
    expect(audio.pause).toHaveBeenCalled();
    expect(onError).not.toHaveBeenCalled();
    expect(inputs(mock)).not.toContain("Three.");
    expect(consoleError).not.toHaveBeenCalled();
    consoleError.mockRestore();
  });

  it("applies the speed preference to every queued sentence", async () => {
    setPlaybackRate(1.25);
    const mock = okSpeech();
    const audio = fakeAudio();
    const { result } = renderHook(() => useTtsPlayer(apiFor(mock), { cache: mkCache(), createAudio: () => audio }));
    act(() => { const q = result.current.playQueue("a1", "m", "v"); q.push("One."); q.push("Two."); q.end(); });
    await flush();
    expect(audio.playbackRate).toBe(1.25);
    audio.playbackRate = 1; // 换 src 会把速率重置
    act(() => audio.onended());
    await flush();
    expect(audio.playbackRate).toBe(1.25);
    act(() => setPlaybackRate(0.75)); // 播放中改语速:登记过的元素立即跟随
    expect(audio.playbackRate).toBe(0.75);
  });

  it("marks first_audio when the first sentence actually starts, once per turn", async () => {
    const mock = okSpeech();
    const audio = fakeAudio();
    startLatencyTrace("text");
    markLatency("reply_first_delta");
    const { result } = renderHook(() => useTtsPlayer(apiFor(mock), { cache: mkCache(), createAudio: () => audio }));
    act(() => { const q = result.current.playQueue("a1", "m", "v"); q.push("One."); q.push("Two."); q.end(); });
    expect(latencyLog()).toHaveLength(0);
    await flush();
    expect(latencyLog()).toHaveLength(1);
    expect(latencyLog()[0]).toMatchObject({ status: "complete" });
    expect(latencyLog()[0].marks.tts_request).toBeDefined();
    expect(latencyLog()[0].marks.first_audio).toBeDefined();
    startLatencyTrace("text");
    markLatency("reply_first_delta");
    act(() => audio.onended());
    await flush();
    expect(latencyLog()).toHaveLength(1); // 第二句不会把 first_audio 记到下一轮
  });

  it("is StrictMode safe: one request per sentence and one play", async () => {
    const mock = okSpeech();
    const audio = fakeAudio();
    const wrapper = ({ children }: { children: ReactNode }) => <StrictMode>{children}</StrictMode>;
    const { result } = renderHook(() => useTtsPlayer(apiFor(mock), { cache: mkCache(), createAudio: () => audio }), { wrapper });
    act(() => { const q = result.current.playQueue("a1", "m", "v"); q.push("One."); q.end(); });
    await flush();
    expect(inputs(mock)).toEqual(["One."]);
    expect(audio.play).toHaveBeenCalledTimes(1);
    act(() => audio.onended());
    await flush();
    expect(result.current.states.a1).toBe("idle");
  });
});
