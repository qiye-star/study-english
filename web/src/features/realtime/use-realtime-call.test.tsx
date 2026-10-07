import { act, renderHook } from "@testing-library/react";
import { StrictMode, type ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ApiClient } from "~/api/client";
import { createFetchMock, json, type Handler } from "~/test/fetch-mock";
import { FakeAudioContext, asContext, fakeStream } from "~/test/fake-audio";
import { BACKGROUND_GRACE_MS, useRealtimeCall } from "./use-realtime-call";
import type { RealtimeEnv } from "./realtime-call";

function render(ticket: Handler, strict = true, capture = {} as RealtimeEnv["capture"]) {
  const mock = createFetchMock({ "POST /api/realtime/ticket": ticket });
  const ctx = new FakeAudioContext();
  const env = {
    WebSocket: vi.fn(), capture, createVad: vi.fn(() => new Promise<never>((): void => undefined)), location: { protocol: "http:", host: "x" }, output: { elementAllowed: false },
    routePrefs: { touch: false }, enterAudioSession: () => (): void => undefined, gestureTarget: new EventTarget(),
  } as unknown as RealtimeEnv;
  const wrapper = ({ children }: { children: ReactNode }) => (strict ? <StrictMode>{children}</StrictMode> : <>{children}</>);
  const view = renderHook(() => useRealtimeCall({
    api: new ApiClient({ getToken: () => "t", fetchImpl: mock.fetch }), conversationId: "c1", context: asContext(ctx), ownsContext: true,
    start: { systemPrompt: "", model: "", temperature: 0.7, voice: "v_1x", saveRecordings: true }, sampleRateOut: 24000, env,
  }), { wrapper });
  return { mock, ctx, view, tickets: () => mock.calls.filter((c) => c.url.pathname === "/api/realtime/ticket").length };
}

function setVisibility(state: DocumentVisibilityState) {
  Object.defineProperty(document, "visibilityState", { configurable: true, get: () => state });
  document.dispatchEvent(new Event("visibilitychange"));
}

afterEach(() => {
  vi.useRealTimers();
  Object.defineProperty(document, "visibilityState", { configurable: true, get: () => "visible" });
});

describe("useRealtimeCall", () => {
  it("StrictMode starts exactly one call and unmount releases the context", async () => {
    vi.useFakeTimers();
    const s = render(() => json({ error: "Realtime is not enabled" }, 503));
    await act(async () => { vi.runAllTimers(); });
    expect(s.tickets()).toBe(1);
    expect(s.view.result.current.model.error).toBe("web.realtime.errors.disabled");
    s.view.unmount();
    expect(s.ctx.close).toHaveBeenCalledTimes(1);
  });

  it("unmounting before the deferred start never starts a call", () => {
    vi.useFakeTimers();
    const s = render(() => json({ ticket: "tk", expires_in: 60 }));
    s.view.unmount();
    vi.runAllTimers();
    expect(s.tickets()).toBe(0);
    expect(s.ctx.close).not.toHaveBeenCalled();
  });

  it("unmount hangs up a call in progress", async () => {
    vi.useFakeTimers();
    const s = render(() => new Promise<Response>(() => undefined)); // 票据请求一直挂着
    await act(async () => { vi.runAllTimers(); });
    expect(s.view.result.current.call).not.toBeNull();
    expect(s.view.result.current.model.phase).toBe("connecting");
    s.view.unmount();
    expect(s.ctx.close).toHaveBeenCalledTimes(1);
    expect(s.mock.calls[0].signal?.aborted).toBe(true);
  });

  it("a page hidden before the deferred start never starts the call and explains why", async () => {
    vi.useFakeTimers();
    const s = render(() => json({ ticket: "tk", expires_in: 60 }), false);
    Object.defineProperty(document, "visibilityState", { configurable: true, get: () => "hidden" }); // 事件已在计时器之前发生
    await act(async () => { vi.runAllTimers(); });
    expect(s.tickets()).toBe(0);
    expect(s.view.result.current.model.phase).toBe("ended");
    expect(s.view.result.current.model.error).toBe("web.realtime.endedInBackground");
    expect(s.ctx.close).toHaveBeenCalledTimes(1);
  });

  it("going to the background ends the call with a notice", async () => {
    vi.useFakeTimers();
    const s = render(() => new Promise<Response>(() => undefined), false);
    await act(async () => { vi.runAllTimers(); });
    await act(async () => { await vi.advanceTimersByTimeAsync(BACKGROUND_GRACE_MS); });
    act(() => setVisibility("hidden"));
    expect(s.view.result.current.model.phase).toBe("ended");
    expect(s.view.result.current.model.error).toBe("web.realtime.endedInBackground");
    expect(s.ctx.close).toHaveBeenCalledTimes(1);
    s.view.unmount();
    expect(s.ctx.close).toHaveBeenCalledTimes(1);
  });

  describe("brief hidden states right after the start (iOS permission prompt / audio session switch)", () => {
    it("a hidden flash in the first 3 s is ignored when the page comes back", async () => {
      vi.useFakeTimers();
      const s = render(() => new Promise<Response>(() => undefined), false);
      await act(async () => { await vi.advanceTimersByTimeAsync(1); });
      act(() => setVisibility("hidden"));
      await act(async () => { await vi.advanceTimersByTimeAsync(800); });
      act(() => setVisibility("visible"));
      await act(async () => { await vi.advanceTimersByTimeAsync(BACKGROUND_GRACE_MS * 2); });
      expect(s.view.result.current.model.error).toBeNull();
      expect(s.view.result.current.model.phase).toBe("connecting");
      expect(s.ctx.close).not.toHaveBeenCalled();
      s.view.unmount();
    });

    it("still hidden when the grace period ends: the call ends (R16)", async () => {
      vi.useFakeTimers();
      const s = render(() => new Promise<Response>(() => undefined), false);
      await act(async () => { await vi.advanceTimersByTimeAsync(1); });
      act(() => setVisibility("hidden"));
      expect(s.view.result.current.model.phase).toBe("connecting");
      await act(async () => { await vi.advanceTimersByTimeAsync(BACKGROUND_GRACE_MS + 600); });
      expect(s.view.result.current.model.error).toBe("web.realtime.endedInBackground");
      expect(s.ctx.close).toHaveBeenCalledTimes(1);
    });

    it("hidden while the microphone permission prompt is open is ignored until the prompt closes", async () => {
      vi.useFakeTimers();
      let grant!: (stream: MediaStream) => void;
      const capture = {
        isSecureContext: true, supportedConstraints: () => ({}), workletUrl: "/w.js",
        getUserMedia: () => new Promise<MediaStream>((r) => { grant = r; }),
      } as unknown as RealtimeEnv["capture"];
      const s = render(() => json({ ticket: "tk", expires_in: 60 }), false, capture);
      await act(async () => { await vi.advanceTimersByTimeAsync(1); });
      await act(async () => { await vi.advanceTimersByTimeAsync(BACKGROUND_GRACE_MS + 100); });
      expect(s.view.result.current.call?.awaitingPermission).toBe(true);
      act(() => setVisibility("hidden")); // 弹窗让页面 hidden
      await act(async () => { await vi.advanceTimersByTimeAsync(5000); });
      expect(s.view.result.current.model.phase).toBe("connecting");
      act(() => setVisibility("visible"));
      grant(fakeStream());
      await act(async () => { await vi.advanceTimersByTimeAsync(10); });
      expect(s.view.result.current.call?.awaitingPermission).toBe(false);
      act(() => setVisibility("hidden")); // 弹窗关了之后真的切走
      expect(s.view.result.current.model.error).toBe("web.realtime.endedInBackground");
    });
  });
});
