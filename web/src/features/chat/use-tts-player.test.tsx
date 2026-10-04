import { act, renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ApiClient } from "~/api/client";
import { createFetchMock, json } from "~/test/fetch-mock";
import { TtsCache } from "./tts";
import { useTtsPlayer } from "./use-tts-player";

function fakeAudio() {
  return { src: "", play: vi.fn(() => Promise.resolve()), pause: vi.fn(), onended: null as null | (() => void) } as unknown as HTMLAudioElement;
}
const mkCache = () => new TtsCache(5, { create: () => "blob:1", revoke: () => {} });
const apiFor = (mock: ReturnType<typeof createFetchMock>) => new ApiClient({ getToken: () => "t", fetchImpl: mock.fetch });

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
});
