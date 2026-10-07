import { act, renderHook } from "@testing-library/react";
import { StrictMode, type ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ApiClient } from "~/api/client";
import { createFetchMock, json, type Handler } from "~/test/fetch-mock";
import { FakeAudioContext, asContext } from "~/test/fake-audio";
import { useRealtimeCall } from "./use-realtime-call";
import type { RealtimeEnv } from "./realtime-call";

function render(ticket: Handler, strict = true) {
  const mock = createFetchMock({ "POST /api/realtime/ticket": ticket });
  const ctx = new FakeAudioContext();
  const env = { WebSocket: vi.fn(), capture: {} as RealtimeEnv["capture"], createVad: vi.fn(), location: { protocol: "http:", host: "x" } } as unknown as RealtimeEnv;
  const wrapper = ({ children }: { children: ReactNode }) => (strict ? <StrictMode>{children}</StrictMode> : <>{children}</>);
  const view = renderHook(() => useRealtimeCall({
    api: new ApiClient({ getToken: () => "t", fetchImpl: mock.fetch }), conversationId: "c1", context: asContext(ctx),
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

  it("going to the background ends the call with a notice", async () => {
    vi.useFakeTimers();
    const s = render(() => new Promise<Response>(() => undefined), false);
    await act(async () => { vi.runAllTimers(); });
    act(() => setVisibility("hidden"));
    expect(s.view.result.current.model.phase).toBe("ended");
    expect(s.view.result.current.model.error).toBe("web.realtime.endedInBackground");
    expect(s.ctx.close).toHaveBeenCalledTimes(1);
    s.view.unmount();
    expect(s.ctx.close).toHaveBeenCalledTimes(1);
  });
});
