import { act, fireEvent, screen } from "@testing-library/react";
import { StrictMode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ApiClient } from "~/api/client";
import { resetPageAudioContextForTests, type CaptureEnv } from "~/audio/capture";
import { createFetchMock, json, type Handler } from "~/test/fetch-mock";
import { FakeAudioContext, asContext } from "~/test/fake-audio";
import "~/test/hold"; // jsdom 的 PointerEvent 补丁(带 button)
import { renderWithProviders } from "~/test/render";
import { INITIAL_CALL, type CallModel } from "./call-machine";
import type { RealtimeEnv } from "./realtime-call";
import { RealtimeCallDialog, RealtimeCallScreen, prepareCallAudio } from "./realtime-call-screen";

function render(model: Partial<CallModel> = {}, level: () => number = () => 0.3) {
  const handlers = { onHangup: vi.fn(), onMute: vi.fn(), onPushToTalk: vi.fn(), onPttDown: vi.fn(), onPttUp: vi.fn(), onClose: vi.fn() };
  const view = renderWithProviders(<RealtimeCallScreen model={{ ...INITIAL_CALL, phase: "listening", ...model }} level={level} {...handlers} />);
  return { ...handlers, view };
}

function setVisibility(state: DocumentVisibilityState) {
  Object.defineProperty(document, "visibilityState", { configurable: true, get: () => state });
  document.dispatchEvent(new Event("visibilitychange"));
}

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  Object.defineProperty(document, "visibilityState", { configurable: true, get: () => "visible" });
  resetPageAudioContextForTests();
});

describe("RealtimeCallScreen", () => {
  it("is an accessible full-screen dialog with a visible microphone indicator", () => {
    render();
    expect(screen.getByTestId("call-screen")).toHaveAttribute("role", "dialog");
    expect(screen.getByTestId("call-screen")).toHaveAttribute("aria-modal", "true");
    expect(screen.getByTestId("call-screen")).toHaveAccessibleName();
    expect(screen.getByTestId("call-status")).toHaveAttribute("data-phase", "listening");
    expect(screen.getByTestId("call-status")).toHaveAttribute("role", "status");
    expect(screen.getByTestId("call-mic-indicator")).toBeVisible();
    expect(screen.getByTestId("call-mic-indicator")).toHaveTextContent(/Microphone in use|麦克风使用中/);
    expect(screen.getByTestId("call-level")).toHaveAttribute("aria-hidden", "true");
    expect(screen.getByTestId("call-captions")).toHaveAttribute("data-lookup-context");
    for (const id of ["call-hangup", "call-mute", "call-ptt-toggle"]) {
      expect(screen.getByTestId(id)).toHaveAccessibleName();
      expect(screen.getByTestId(id).className).toMatch(/min-h-11/);
      expect(screen.getByTestId(id).className).toMatch(/min-w-11/);
    }
  });

  it("shows captions, the partial transcript, scores and an interrupted marker", () => {
    render({
      partial: "and a cro",
      captions: [
        { key: "u-m1", role: "user", text: "A latte please", messageId: "m1", score: 82 },
        { key: "u-m2", role: "user", text: "Thanks", messageId: "m2" },
        { key: "a-1", role: "assistant", text: "Sure. What size", turnId: 1, interrupted: true },
      ],
    });
    expect(screen.getByTestId("call-captions")).toHaveTextContent("A latte please");
    expect(screen.getByTestId("call-captions")).toHaveTextContent("82");
    expect(screen.getByTestId("call-captions")).toHaveTextContent(/interrupted|已打断/);
    expect(screen.getByTestId("call-partial")).toHaveTextContent("and a cro");
    // 只有拿到分数的用户字幕带徽章
    const badges = screen.getAllByTestId("call-score");
    expect(badges).toHaveLength(1);
    expect(badges[0]).toHaveAttribute("data-score", "82");
  });

  it("buttons call their handlers and reflect pressed state", () => {
    const h = render({ muted: true });
    expect(screen.getByTestId("call-mute")).toHaveAttribute("aria-pressed", "true");
    fireEvent.click(screen.getByTestId("call-mute"));
    expect(h.onMute).toHaveBeenCalledWith(false);
    expect(screen.getByTestId("call-ptt-toggle")).toHaveAttribute("aria-pressed", "false");
    fireEvent.click(screen.getByTestId("call-ptt-toggle"));
    expect(h.onPushToTalk).toHaveBeenCalledWith(true);
    fireEvent.click(screen.getByTestId("call-hangup"));
    expect(h.onHangup).toHaveBeenCalled();
  });

  it("push-to-talk mode shows a hold button usable by pointer and keyboard", () => {
    const h = render({ pushToTalk: true });
    const ptt = screen.getByTestId("call-ptt");
    expect(ptt.className).toMatch(/min-h-11/);
    fireEvent.pointerDown(ptt);
    fireEvent.pointerUp(ptt);
    fireEvent.keyDown(ptt, { key: " " });
    fireEvent.keyUp(ptt, { key: " " });
    expect(h.onPttDown).toHaveBeenCalledTimes(2);
    expect(h.onPttUp).toHaveBeenCalledTimes(2);
  });

  it("the hold button ignores key repeat and duplicate releases, and releases on blur and unmount", () => {
    const h = render({ pushToTalk: true });
    const ptt = screen.getByTestId("call-ptt");
    fireEvent.keyDown(ptt, { key: "Enter" });
    fireEvent.keyDown(ptt, { key: "Enter", repeat: true });
    fireEvent.pointerDown(ptt); // 已按住:不重复开始
    expect(h.onPttDown).toHaveBeenCalledTimes(1);
    fireEvent.focusOut(ptt);
    expect(h.onPttUp).toHaveBeenCalledTimes(1);
    fireEvent.keyUp(ptt, { key: "Enter" }); // 已经松开:不重复
    expect(h.onPttUp).toHaveBeenCalledTimes(1);
    fireEvent.pointerDown(ptt, { button: 2 }); // 右键不算
    expect(h.onPttDown).toHaveBeenCalledTimes(1);
    fireEvent.pointerDown(ptt);
    h.view.unmount();
    expect(h.onPttDown).toHaveBeenCalledTimes(2);
    expect(h.onPttUp).toHaveBeenCalledTimes(2);
  });

  it("the hold button is disabled while muted and absent outside push-to-talk mode", () => {
    render({ pushToTalk: true, muted: true });
    expect(screen.getByTestId("call-ptt")).toBeDisabled();
  });

  it("has no hold button in voice-detection mode", () => {
    render();
    expect(screen.queryByTestId("call-ptt")).toBeNull();
  });

  it("notices, degraded mode and the end screen", () => {
    const h = render({ phase: "ended", error: "web.realtime.errors.idle_timeout", degraded: true, notice: "web.realtime.noSpeech" });
    expect(screen.getByTestId("call-error")).toHaveTextContent(/silence|没有说话/);
    expect(screen.getByTestId("call-degraded")).toHaveTextContent(/slow|慢/);
    expect(screen.getByTestId("call-notice")).toHaveAttribute("role", "status");
    expect(screen.queryByTestId("call-mic-indicator")).toBeNull();
    expect(screen.queryByTestId("call-hangup")).toBeNull();
    expect(screen.getByTestId("call-close").className).toMatch(/min-h-11/);
    fireEvent.click(screen.getByTestId("call-close"));
    expect(h.onClose).toHaveBeenCalled();
  });

  it("maps microphone errors and unknown keys to readable text", () => {
    const { view } = render({ phase: "ended", error: "web.recorder.permission_denied" });
    expect(screen.getByTestId("call-error").textContent).not.toContain("web.recorder");
    view.unmount();
    render({ notice: "web.realtime.errors.some_new_code" });
    expect(screen.getByTestId("call-notice")).toHaveTextContent(/disconnected|断开/);
  });

  it("degraded mode shows a notice during the call", () => {
    render({ degraded: true });
    expect(screen.getByTestId("call-degraded")).toBeVisible();
  });

  it("Escape hangs up during the call and closes once it has ended", () => {
    const h = render();
    fireEvent.keyDown(screen.getByTestId("call-hangup"), { key: "Escape" });
    expect(h.onHangup).toHaveBeenCalledTimes(1);
    h.view.unmount();
    const e = render({ phase: "ended", error: "web.realtime.errors.max_duration" });
    fireEvent.keyDown(screen.getByTestId("call-close"), { key: "Escape" });
    expect(e.onClose).toHaveBeenCalledTimes(1);
    expect(e.onHangup).not.toHaveBeenCalled();
  });

  it("moves focus into the dialog and to the close button when the call ends", () => {
    const h = render();
    expect(screen.getByTestId("call-hangup")).toHaveFocus();
    h.view.rerender(
      <RealtimeCallScreen model={{ ...INITIAL_CALL, phase: "ended", error: "web.realtime.errors.generic" }} level={() => 0}
        onHangup={h.onHangup} onMute={h.onMute} onPushToTalk={h.onPushToTalk} onPttDown={h.onPttDown} onPttUp={h.onPttUp} onClose={h.onClose} />,
    );
    expect(screen.getByTestId("call-close")).toHaveFocus();
  });

  describe("modal focus containment", () => {
    function withOpener() {
      const outside = document.createElement("div");
      const opener = document.createElement("button");
      opener.textContent = "open call";
      outside.appendChild(opener);
      document.body.appendChild(outside);
      opener.focus();
      return { outside, opener, cleanup: () => outside.remove() };
    }

    it("makes the page behind the dialog inert and restores it on close", () => {
      const o = withOpener();
      const h = render();
      const dialog = screen.getByTestId("call-screen");
      expect(o.outside).toHaveAttribute("inert");
      expect(o.outside).toHaveAttribute("aria-hidden", "true");
      for (let el: HTMLElement | null = dialog; el; el = el.parentElement) expect(el).not.toHaveAttribute("inert");
      h.view.unmount();
      expect(o.outside).not.toHaveAttribute("inert");
      expect(o.outside).not.toHaveAttribute("aria-hidden");
      o.cleanup();
    });

    it("returns focus to the control that opened the call", () => {
      const o = withOpener();
      const h = render();
      expect(screen.getByTestId("call-hangup")).toHaveFocus();
      h.view.unmount();
      expect(o.opener).toHaveFocus();
      o.cleanup();
    });

    it("Tab and Shift+Tab wrap inside the dialog", () => {
      render();
      const mute = screen.getByTestId("call-mute");
      const toggle = screen.getByTestId("call-ptt-toggle");
      toggle.focus();
      fireEvent.keyDown(toggle, { key: "Tab" });
      expect(mute).toHaveFocus();
      fireEvent.keyDown(mute, { key: "Tab", shiftKey: true });
      expect(toggle).toHaveFocus();
    });

    it("focus that lands outside the dialog is pulled back in", () => {
      const o = withOpener();
      render();
      act(() => o.opener.focus());
      expect(screen.getByTestId("call-screen").contains(document.activeElement)).toBe(true);
      o.cleanup();
    });
  });

  describe("without voice detection (VAD failed to load)", () => {
    it("locks push-to-talk on with a visible reason", () => {
      render({ pushToTalk: true, vadUnavailable: true });
      const toggle = screen.getByTestId("call-ptt-toggle");
      expect(toggle).toBeDisabled();
      expect(screen.getByTestId("call-ptt-locked")).toBeVisible();
      expect(toggle).toHaveAttribute("aria-describedby", screen.getByTestId("call-ptt-locked").id);
    });

    it("offers a tap-to-talk toggle (screen readers cannot hold a button)", () => {
      const h = render({ pushToTalk: true, vadUnavailable: true });
      const tap = screen.getByTestId("call-ptt-tap");
      expect(tap).toHaveAttribute("aria-pressed", "false");
      expect(tap).toHaveAccessibleName();
      expect(tap.className).toMatch(/min-h-11/);
      fireEvent.click(tap);
      expect(h.onPttDown).toHaveBeenCalledTimes(1);
      expect(tap).toHaveAttribute("aria-pressed", "true");
      fireEvent.click(tap);
      expect(h.onPttUp).toHaveBeenCalledTimes(1);
      expect(tap).toHaveAttribute("aria-pressed", "false");
      fireEvent.click(tap);
      h.view.unmount(); // 说着话关掉:这句结束
      expect(h.onPttUp).toHaveBeenCalledTimes(2);
    });

    it("tap and hold exclude each other: a hold release can never end a tapped utterance (review F2 m3)", () => {
      const h = render({ pushToTalk: true, vadUnavailable: true });
      const tap = screen.getByTestId("call-ptt-tap");
      const hold = screen.getByTestId("call-ptt");
      fireEvent.click(tap);
      expect(tap).toHaveAttribute("aria-pressed", "true");
      expect(hold).toBeDisabled();
      fireEvent.pointerDown(hold);
      fireEvent.pointerUp(hold);
      expect(h.onPttDown).toHaveBeenCalledTimes(1);
      expect(h.onPttUp).not.toHaveBeenCalled(); // 还在说:点按键仍是"点按结束说话"
      expect(tap).toHaveTextContent(/Tap to stop|点按结束/);
      fireEvent.click(tap);
      expect(h.onPttUp).toHaveBeenCalledTimes(1);
      expect(hold).toBeEnabled();
      // 反过来:按住期间点按键不可用
      fireEvent.pointerDown(hold);
      expect(tap).toBeDisabled();
      fireEvent.click(tap);
      expect(tap).toHaveAttribute("aria-pressed", "false");
      fireEvent.pointerUp(hold);
      expect(h.onPttDown).toHaveBeenCalledTimes(2);
      expect(h.onPttUp).toHaveBeenCalledTimes(2);
      expect(tap).toBeEnabled();
    });

    it("has no tap toggle while voice detection works", () => {
      render({ pushToTalk: true });
      expect(screen.queryByTestId("call-ptt-tap")).toBeNull();
      expect(screen.getByTestId("call-ptt-toggle")).toBeEnabled();
    });
  });

  it("drives the level meter from level() without re-rendering and stops on unmount", () => {
    vi.useFakeTimers();
    vi.stubGlobal("requestAnimationFrame", undefined);
    vi.stubGlobal("cancelAnimationFrame", undefined);
    const level = vi.fn(() => 0.2);
    const h = render({}, level);
    act(() => { vi.advanceTimersByTime(120); });
    expect(level).toHaveBeenCalled();
    const bar = screen.getByTestId("call-level").firstElementChild as HTMLElement;
    expect(bar.style.width).toBe("60%");
    h.view.unmount();
    const calls = level.mock.calls.length;
    vi.advanceTimersByTime(500);
    expect(level.mock.calls.length).toBe(calls);
    vi.unstubAllGlobals();
  });
});

describe("prepareCallAudio", () => {
  it("unlocks the shared page AudioContext synchronously and never hands over ownership", () => {
    const ctx = new FakeAudioContext();
    const env = { createAudioContext: () => asContext(ctx) } as unknown as CaptureEnv;
    const audio = prepareCallAudio(env);
    expect(audio).toEqual({ context: ctx, ownsContext: false });
    expect(ctx.resume).toHaveBeenCalledTimes(1); // 同步:还没有任何 await
    expect(ctx.createBufferSource).toHaveBeenCalled();
  });

  it("returns null when the browser has no AudioContext", () => {
    expect(prepareCallAudio({} as CaptureEnv)).toBeNull();
  });
});

describe("RealtimeCallDialog", () => {
  const START = { systemPrompt: "", model: "", temperature: 0.7, voice: "v_1x", saveRecordings: true };

  function mount(ticket: Handler, { strict = true, ownsContext = false } = {}) {
    const mock = createFetchMock({ "POST /api/realtime/ticket": ticket });
    const ctx = new FakeAudioContext();
    const env = { WebSocket: vi.fn(), capture: {} as RealtimeEnv["capture"], createVad: vi.fn(), location: { protocol: "http:", host: "x" } } as unknown as RealtimeEnv;
    const onClose = vi.fn();
    const ui = (
      <RealtimeCallDialog api={new ApiClient({ getToken: () => "t", fetchImpl: mock.fetch })} conversationId="c1"
        context={asContext(ctx)} ownsContext={ownsContext} start={START} sampleRateOut={24000} env={env} onClose={onClose} />
    );
    const view = renderWithProviders(strict ? <StrictMode>{ui}</StrictMode> : ui);
    return { mock, ctx, onClose, view, tickets: () => mock.calls.filter((c) => c.url.pathname === "/api/realtime/ticket").length };
  }

  it("StrictMode starts one call; hanging up closes the dialog and leaves the shared context open", async () => {
    vi.useFakeTimers();
    const s = mount(() => new Promise<Response>(() => undefined));
    await act(async () => { await vi.advanceTimersByTimeAsync(10); });
    expect(s.tickets()).toBe(1);
    expect(screen.getByTestId("call-status")).toHaveAttribute("data-phase", "connecting");
    fireEvent.click(screen.getByTestId("call-hangup"));
    expect(s.onClose).toHaveBeenCalledTimes(1);
    // 交给页面的是这通电话的套接字结局(页面等它关闭再重新加载)
    expect(s.onClose).toHaveBeenCalledWith(expect.objectContaining({ opened: false, closed: expect.any(Promise), drop: expect.any(Function) }));
    expect(s.mock.calls[0].signal?.aborted).toBe(true);
    expect(s.ctx.close).not.toHaveBeenCalled();
  });

  it("Escape hangs up and closes", async () => {
    vi.useFakeTimers();
    const s = mount(() => new Promise<Response>(() => undefined));
    await act(async () => { await vi.advanceTimersByTimeAsync(10); });
    fireEvent.keyDown(screen.getByTestId("call-screen"), { key: "Escape" });
    expect(s.onClose).toHaveBeenCalledTimes(1);
    expect(s.mock.calls[0].signal?.aborted).toBe(true);
  });

  it("a call that ends for another reason stays open with the reason and a close button", async () => {
    vi.useFakeTimers();
    const s = mount(() => json({ error: "Realtime is not enabled" }, 503));
    await act(async () => { await vi.advanceTimersByTimeAsync(10); });
    expect(screen.getByTestId("call-status")).toHaveAttribute("data-phase", "ended");
    expect(screen.getByTestId("call-error")).toHaveTextContent(/not enabled|未启用|未开启/);
    expect(s.onClose).not.toHaveBeenCalled();
    fireEvent.click(screen.getByTestId("call-close"));
    expect(s.onClose).toHaveBeenCalledTimes(1);
    expect(s.onClose).toHaveBeenCalledWith(expect.objectContaining({ opened: false, closed: expect.any(Promise) }));
  });

  it("going to the background hangs up and explains it on return (R16)", async () => {
    vi.useFakeTimers();
    const s = mount(() => new Promise<Response>(() => undefined), { strict: false, ownsContext: true });
    await act(async () => { await vi.advanceTimersByTimeAsync(10); });
    act(() => setVisibility("hidden"));
    expect(s.ctx.close).toHaveBeenCalledTimes(1);
    act(() => setVisibility("visible"));
    expect(screen.getByTestId("call-error")).toHaveTextContent(/background|后台/);
    expect(screen.queryByTestId("call-mic-indicator")).toBeNull();
    expect(s.onClose).not.toHaveBeenCalled();
  });

  it("unmounting mid-call releases everything without state updates after unmount", async () => {
    vi.useFakeTimers();
    const errors = vi.spyOn(console, "error");
    let resolve!: (r: Response) => void;
    const s = mount(() => new Promise<Response>((r) => { resolve = r; }), { ownsContext: true });
    await act(async () => { await vi.advanceTimersByTimeAsync(10); });
    s.view.unmount();
    expect(s.ctx.close).toHaveBeenCalledTimes(1);
    resolve(new Response(JSON.stringify({ ticket: "tk", expires_in: 60 }), { headers: { "content-type": "application/json" } }));
    await act(async () => { await vi.advanceTimersByTimeAsync(200); });
    expect(s.ctx.close).toHaveBeenCalledTimes(1);
    expect(errors).not.toHaveBeenCalled();
  });
});
