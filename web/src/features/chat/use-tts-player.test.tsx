import { act, renderHook } from "@testing-library/react";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import i18n from "~/i18n";
import { ApiClient } from "~/api/client";
import { createFetchMock, json } from "~/test/fetch-mock";
import { claimAudio } from "~/audio/audio-focus";
import { TtsCache } from "./tts";
import { resetPlaybackRateForTests, setPlaybackRate } from "~/lib/playback-rate";
import { TtsPlaybackError, sharedAutoplayAudio, ttsErrorMessage, useTtsPlayer } from "./use-tts-player";

function fakeAudio() {
  return { src: "", play: vi.fn(() => Promise.resolve()), pause: vi.fn(), onended: null as null | (() => void) } as unknown as HTMLAudioElement;
}
const mkCache = () => new TtsCache(5, { create: () => "blob:1", revoke: () => {} });
const apiFor = (mock: ReturnType<typeof createFetchMock>) => new ApiClient({ getToken: () => "t", fetchImpl: mock.fetch });

beforeAll(() => {
  Object.assign(URL, { createObjectURL: vi.fn(() => "blob:silent"), revokeObjectURL: vi.fn() });
});

describe("useTtsPlayer", () => {
  it("fetches once, then plays from the cache", async () => {
    const mock = createFetchMock({ "POST /api/ai/audio/speech": () => new Response(new Uint8Array([1])) });
    const audio = fakeAudio();
    const cache = mkCache();
    const { result } = renderHook(() => useTtsPlayer(apiFor(mock), { cache, createAudio: () => audio }));
    await act(() => result.current.play("m1", "Hello", "openai/tts-1", "alloy"));
    expect(result.current.states.m1).toBe("playing");
    act(() => (audio.onended as () => void)());
    expect(result.current.states.m1).toBe("idle");
    await act(() => result.current.play("m1", "Hello", "openai/tts-1", "alloy"));
    expect(mock.calls.filter((c) => c.url.pathname === "/api/ai/audio/speech")).toHaveLength(1);
  });
  it("reports errors", async () => {
    const mock = createFetchMock({ "POST /api/ai/audio/speech": () => json({ error: "Upstream unavailable" }, 502) });
    const onError = vi.fn();
    const { result } = renderHook(() => useTtsPlayer(apiFor(mock), { cache: mkCache(), createAudio: fakeAudio, onError }));
    await act(() => result.current.play("m2", "Hi", "openai/tts-1", "alloy"));
    expect(result.current.states.m2).toBe("error");
    expect(onError).toHaveBeenCalledTimes(1);
    expect((onError.mock.calls[0][0] as { message: string }).message).toBe("Upstream unavailable");
  });
  it("toggles off while playing", async () => {
    const mock = createFetchMock({ "POST /api/ai/audio/speech": () => new Response(new Uint8Array([1])) });
    const audio = fakeAudio();
    const { result } = renderHook(() => useTtsPlayer(apiFor(mock), { cache: mkCache(), createAudio: () => audio }));
    await act(() => result.current.play("m1", "Hello", "openai/tts-1", "alloy"));
    await act(() => result.current.play("m1", "Hello", "openai/tts-1", "alloy"));
    expect(result.current.states.m1).toBe("idle");
    expect(audio.pause).toHaveBeenCalled();
  });
  it("aborts a pending request on a new play so only the latest plays", async () => {
    const signals: AbortSignal[] = [];
    const mock = createFetchMock({
      "POST /api/ai/audio/speech": (call) => {
        signals.push(call.signal as AbortSignal);
        return signals.length === 1
          ? new Promise<Response>((_, reject) => call.signal!.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError"))))
          : new Response(new Uint8Array([1]));
      },
    });
    const onError = vi.fn();
    const { result } = renderHook(() => useTtsPlayer(apiFor(mock), { cache: mkCache(), createAudio: fakeAudio, onError }));
    let first!: Promise<void>;
    act(() => { first = result.current.play("a", "One", "m", "alloy"); });
    await act(() => result.current.play("b", "Two", "m", "alloy"));
    await act(() => first);
    expect(signals[0].aborted).toBe(true);
    expect(result.current.states.a).toBe("idle");
    expect(result.current.states.b).toBe("playing");
    expect(onError).not.toHaveBeenCalled();
  });
  it("aborts the request and pauses on unmount", async () => {
    let signal: AbortSignal | null | undefined;
    const mock = createFetchMock({ "POST /api/ai/audio/speech": (call) => { signal = call.signal; return new Promise<Response>(() => {}); } });
    const audio = fakeAudio();
    const { result, unmount } = renderHook(() => useTtsPlayer(apiFor(mock), { cache: mkCache(), createAudio: () => audio }));
    act(() => { void result.current.play("a", "One", "m", "alloy"); });
    unmount();
    expect(signal?.aborted).toBe(true);
    expect(audio.pause).toHaveBeenCalled();
  });
  it("iOS: starts the silent clip synchronously inside the tap, before the fetch completes", async () => {
    const order: string[] = [];
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const mock = createFetchMock({ "POST /api/ai/audio/speech": async () => { order.push("fetch-start"); await gate; order.push("fetch-done"); return new Response(new Uint8Array([1])); } });
    const audio = fakeAudio();
    (audio.play as ReturnType<typeof vi.fn>).mockImplementation(() => { order.push(`play:${audio.src}`); return Promise.resolve(); });
    const { result } = renderHook(() => useTtsPlayer(apiFor(mock), { cache: mkCache(), createAudio: () => audio }));
    let pending!: Promise<void>;
    act(() => { pending = result.current.play("m1", "Hello", "m", "alloy"); }); // the synchronous tap handler
    expect(order[0]).toBe("play:blob:silent");
    expect(order).not.toContain("fetch-done");
    expect(result.current.states.m1).toBe("loading");
    release();
    await act(() => pending);
    expect(order.slice(0, 3)).toEqual(["play:blob:silent", "fetch-start", "fetch-done"]);
    expect(order.at(-1)).toBe("play:blob:1");
  });
  it("does not request or unlock anything when there is nothing speakable", async () => {
    const mock = createFetchMock({});
    const audio = fakeAudio();
    const onNothingToRead = vi.fn();
    const { result } = renderHook(() => useTtsPlayer(apiFor(mock), { cache: mkCache(), createAudio: () => audio, onNothingToRead }));
    await act(() => result.current.play("m1", "```js" + String.fromCharCode(10) + "x()" + String.fromCharCode(10) + "```", "m", "alloy"));
    expect(onNothingToRead).toHaveBeenCalledTimes(1);
    expect(mock.calls).toHaveLength(0);
    expect(result.current.states.m1).toBeUndefined();
  });
  it("reports a blocked or undecodable playback as a playback error", async () => {
    const mock = createFetchMock({ "POST /api/ai/audio/speech": () => new Response(new Uint8Array([1])) });
    const audio = fakeAudio();
    let calls = 0;
    (audio.play as ReturnType<typeof vi.fn>).mockImplementation(() => (++calls === 1 ? Promise.resolve() : Promise.reject(new DOMException("blocked", "NotAllowedError"))));
    const onError = vi.fn();
    const { result } = renderHook(() => useTtsPlayer(apiFor(mock), { cache: mkCache(), createAudio: () => audio, onError }));
    await act(() => result.current.play("m1", "Hello", "m", "alloy"));
    expect(result.current.states.m1).toBe("error");
    expect(onError.mock.calls[0][0]).toBeInstanceOf(TtsPlaybackError);
    expect(ttsErrorMessage(i18n.t, onError.mock.calls[0][0])).toBe("Could not play the reply.");
  });
  it("reports a decode error from the audio element", async () => {
    const mock = createFetchMock({ "POST /api/ai/audio/speech": () => new Response(new Uint8Array([1])) });
    const audio = fakeAudio() as HTMLAudioElement & { onerror: null | (() => void) };
    const onError = vi.fn();
    const { result } = renderHook(() => useTtsPlayer(apiFor(mock), { cache: mkCache(), createAudio: () => audio, onError }));
    await act(() => result.current.play("m1", "Hello", "m", "alloy"));
    expect(result.current.states.m1).toBe("playing");
    act(() => audio.onerror?.());
    expect(result.current.states.m1).toBe("error");
    expect(onError.mock.calls[0][0]).toBeInstanceOf(TtsPlaybackError);
  });
  describe("releases the audio focus so no stale stop() closure is left behind", () => {
    const speech = () => createFetchMock({ "POST /api/ai/audio/speech": () => new Response(new Uint8Array([1])) });
    it("after natural playback end", async () => {
      const audio = fakeAudio() as HTMLAudioElement & { onerror: null | (() => void) };
      const { result } = renderHook(() => useTtsPlayer(apiFor(speech()), { cache: mkCache(), createAudio: () => audio }));
      await act(() => result.current.play("m1", "Hello", "m", "alloy"));
      act(() => (audio.onended as () => void)());
      const pauses = vi.mocked(audio.pause).mock.calls.length;
      act(() => claimAudio(vi.fn()));
      expect(vi.mocked(audio.pause).mock.calls.length).toBe(pauses);
    });
    it("after a playback failure", async () => {
      const audio = fakeAudio() as HTMLAudioElement & { onerror: null | (() => void) };
      const { result } = renderHook(() => useTtsPlayer(apiFor(speech()), { cache: mkCache(), createAudio: () => audio, onError: vi.fn() }));
      await act(() => result.current.play("m1", "Hello", "m", "alloy"));
      act(() => audio.onerror?.());
      expect(result.current.states.m1).toBe("error");
      const pauses = vi.mocked(audio.pause).mock.calls.length;
      act(() => claimAudio(vi.fn()));
      expect(vi.mocked(audio.pause).mock.calls.length).toBe(pauses);
    });
    it("on unmount", async () => {
      const audio = fakeAudio();
      const { result, unmount } = renderHook(() => useTtsPlayer(apiFor(speech()), { cache: mkCache(), createAudio: () => audio }));
      await act(() => result.current.play("m1", "Hello", "m", "alloy"));
      unmount();
      const pauses = vi.mocked(audio.pause).mock.calls.length;
      act(() => claimAudio(vi.fn()));
      expect(vi.mocked(audio.pause).mock.calls.length).toBe(pauses);
    });
  });
  describe("speed, priming and per-call options", () => {
    const speech = () => createFetchMock({ "POST /api/ai/audio/speech": () => new Response(new Uint8Array([1])) });
    beforeEach(() => { localStorage.clear(); resetPlaybackRateForTests(); });

    it("plays at the global speed with pitch preserved, and follows a change mid-playback", async () => {
      setPlaybackRate(1.25);
      const audio = fakeAudio() as HTMLAudioElement & { preservesPitch?: boolean };
      const { result } = renderHook(() => useTtsPlayer(apiFor(speech()), { cache: mkCache(), createAudio: () => audio }));
      await act(() => result.current.play("m1", "Hello", "openai/tts-1", "alloy"));
      expect([audio.playbackRate, audio.defaultPlaybackRate, audio.preservesPitch]).toEqual([1.25, 1.25, true]);
      act(() => setPlaybackRate(0.75));
      expect(audio.playbackRate).toBe(0.75);
    });

    it("stops following the speed after unmount", async () => {
      const audio = fakeAudio();
      const { result, unmount } = renderHook(() => useTtsPlayer(apiFor(speech()), { cache: mkCache(), createAudio: () => audio }));
      await act(() => result.current.play("m1", "Hello", "openai/tts-1", "alloy"));
      unmount();
      setPlaybackRate(1.25);
      expect(audio.playbackRate).toBe(1);
    });

    it("prime() unlocks the element synchronously and reuses it for the next play", async () => {
      const audio = fakeAudio();
      const create = vi.fn(() => audio);
      const { result } = renderHook(() => useTtsPlayer(apiFor(speech()), { cache: mkCache(), createAudio: create }));
      act(() => result.current.prime());
      expect(audio.play).toHaveBeenCalledTimes(1);
      expect(audio.src).toBe("blob:silent");
      await act(() => result.current.play("m1", "Hello", "openai/tts-1", "alloy"));
      expect(create).toHaveBeenCalledTimes(1);
    });

    it("prime() interrupts current playback: idle at once, the old onended cannot fire into new state", async () => {
      const audio = fakeAudio();
      const { result } = renderHook(() => useTtsPlayer(apiFor(speech()), { cache: mkCache(), createAudio: () => audio }));
      await act(() => result.current.play("m1", "Hello", "openai/tts-1", "alloy"));
      expect(result.current.states.m1).toBe("playing");
      const oldEnded = audio.onended as () => void;
      act(() => result.current.prime());
      expect(result.current.states.m1).toBe("idle");
      expect(audio.pause).toHaveBeenCalled();
      expect(audio.onended).toBeNull();
      await act(() => result.current.play("m2", "Other", "openai/tts-1", "alloy"));
      act(() => oldEnded());
      expect(result.current.states.m2).toBe("playing");
    });

    it("an element error from call A does not reach call B's onError; the global one fires without a handler", async () => {
      const audio = fakeAudio() as HTMLAudioElement & { onerror: null | (() => void) };
      const global = vi.fn();
      const a = vi.fn();
      const b = vi.fn();
      const { result } = renderHook(() => useTtsPlayer(apiFor(speech()), { cache: mkCache(), createAudio: () => audio, onError: global }));
      await act(() => result.current.play("a", "Hello", "openai/tts-1", "alloy", { onError: a }));
      const staleErr = audio.onerror as () => void;
      await act(() => result.current.play("b", "World", "openai/tts-1", "alloy", { onError: b }));
      act(() => staleErr());
      expect(a).not.toHaveBeenCalled();
      expect(b).not.toHaveBeenCalled();
      act(() => (audio.onerror as () => void)());
      expect(b).toHaveBeenCalledTimes(1);
      expect(global).not.toHaveBeenCalled();
      await act(() => result.current.play("c", "Again", "openai/tts-1", "alloy"));
      act(() => (audio.onerror as () => void)());
      expect(global).toHaveBeenCalledTimes(1);
    });

    it("a per-call onError replaces the global one; quietIfEmpty skips the nothing-to-read callback", async () => {
      const mock = createFetchMock({ "POST /api/ai/audio/speech": () => json({ error: "Upstream unavailable" }, 502) });
      const global = vi.fn();
      const nothing = vi.fn();
      const local = vi.fn();
      const { result } = renderHook(() => useTtsPlayer(apiFor(mock), { cache: mkCache(), createAudio: fakeAudio, onError: global, onNothingToRead: nothing }));
      await act(() => result.current.play("m1", "Hi", "openai/tts-1", "alloy", { onError: local }));
      expect(local).toHaveBeenCalledTimes(1);
      expect(global).not.toHaveBeenCalled();
      await act(() => result.current.play("m2", "```js\nx()\n```", "openai/tts-1", "alloy", { quietIfEmpty: true }));
      expect(nothing).not.toHaveBeenCalled();
      await act(() => result.current.play("m3", "```js\nx()\n```", "openai/tts-1", "alloy"));
      expect(nothing).toHaveBeenCalledTimes(1);
    });

    it("sharedAutoplayAudio is one element for the whole app", () => {
      expect(sharedAutoplayAudio()).toBe(sharedAutoplayAudio());
      expect(sharedAutoplayAudio()).toBeInstanceOf(HTMLAudioElement);
    });
  });
});
