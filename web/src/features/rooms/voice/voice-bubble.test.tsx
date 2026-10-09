import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ReactElement } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ApiClient } from "~/api/client";
import i18n from "~/i18n";
import { createFetchMock, json } from "~/test/fetch-mock";
import { TestProviders } from "~/test/render";
import type { RoomMessage, VoiceInfo } from "../protocol";
import { TRANSLATE_STALL_MS } from "./translate-queue";
import { VoiceBubble } from "./voice-bubble";

/** IntersectionObserver stub: show(true) puts every observed bubble in view. */
function stubIntersection() {
  const observers: { cb: IntersectionObserverCallback; els: Element[] }[] = [];
  class IO {
    els: Element[] = [];
    constructor(readonly cb: IntersectionObserverCallback) { observers.push(this); }
    observe(el: Element) { this.els.push(el); }
    unobserve() { /* noop */ }
    disconnect() { this.els = []; }
    takeRecords(): IntersectionObserverEntry[] { return []; }
  }
  vi.stubGlobal("IntersectionObserver", IO);
  return {
    show(visible: boolean) {
      act(() => {
        for (const o of observers) {
          o.cb(o.els.map((target) => ({ target, isIntersecting: visible }) as IntersectionObserverEntry), o as unknown as IntersectionObserver);
        }
      });
    },
  };
}

/** rerender 也要带上 Provider:用 wrapper 而不是把 Provider 写进 ui */
function renderWithProviders(ui: ReactElement, { api }: { api?: ApiClient } = {}) {
  return render(ui, { wrapper: ({ children }) => <TestProviders api={api}>{children}</TestProviders> });
}

const voice = (over: Partial<VoiceInfo> = {}): VoiceInfo => ({ durationMs: 6400, status: "done", transcript: "I tried the new noodle place.", lang: "en",
  translation: null, translationStatus: null, attempts: 1, audio: true, ...over });
const message = (v: VoiceInfo): RoomMessage => ({ seq: 7, id: "m7", lane: "public", kind: "voice", sender: { kind: "user", id: 22, name: "bob" },
  text: v.transcript ?? "", assisted: false, replyTo: null, aiStatus: null, meta: null, createdAt: "", quote: null, voice: v, reactions: [] } as RoomMessage);

describe("VoiceBubble", () => {
  beforeEach(() => { localStorage.setItem("enjoy-web.settings", JSON.stringify({ language: "zh-CN" })); });
  afterEach(async () => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); localStorage.removeItem("enjoy-web.settings"); await i18n.changeLanguage("en"); });

  it("hides others' transcripts until asked and requests translation once", () => {
    const onTranslate = vi.fn();
    renderWithProviders(<VoiceBubble message={message(voice())} mine={false} roomId="r1" autoText={false} onTranslate={onTranslate} onRetry={vi.fn()} />);
    expect(screen.getByText("0:06")).toBeTruthy();
    expect(screen.queryByText("I tried the new noodle place.")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "转文字" }));
    expect(screen.getByText("I tried the new noodle place.")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "翻译" }));
    expect(onTranslate).toHaveBeenCalledWith(7);
    expect(screen.getByText("正在翻译…")).toBeTruthy();
  });

  it("auto text asks for the translation only once the bubble is in view (review M3)", () => {
    const io = stubIntersection();
    const onTranslate = vi.fn(() => true);
    const { rerender } = renderWithProviders(<VoiceBubble message={message(voice())} mine={false} roomId="r1" autoText onTranslate={onTranslate} onRetry={vi.fn()} />);
    expect(screen.getByText("I tried the new noodle place.")).toBeTruthy();
    expect(onTranslate).not.toHaveBeenCalled(); // history far above the viewport costs nothing
    io.show(true);
    expect(onTranslate).toHaveBeenCalledTimes(1);
    expect(screen.getByText("正在翻译…")).toBeTruthy();
    rerender(<VoiceBubble message={message(voice({ translationStatus: "pending" }))} mine={false} roomId="r1" autoText onTranslate={onTranslate} onRetry={vi.fn()} />);
    expect(onTranslate).toHaveBeenCalledTimes(1);
  });

  it("auto text asks for the translation once the transcript arrives", () => {
    const io = stubIntersection();
    const onTranslate = vi.fn(() => true);
    const pending = voice({ status: "pending", transcript: null, lang: null });
    const { rerender } = renderWithProviders(<VoiceBubble message={message(pending)} mine={false} roomId="r1" autoText onTranslate={onTranslate} onRetry={vi.fn()} />);
    io.show(true);
    expect(screen.getByText("正在转文字…")).toBeTruthy();
    expect(onTranslate).not.toHaveBeenCalled();
    rerender(<VoiceBubble message={message(voice())} mine={false} roomId="r1" autoText onTranslate={onTranslate} onRetry={vi.fn()} />);
    expect(onTranslate).toHaveBeenCalledTimes(1);
  });

  it("does not spin forever when the request could not be sent", () => {
    const io = stubIntersection();
    const onTranslate = vi.fn(() => false); // offline
    renderWithProviders(<VoiceBubble message={message(voice())} mine={false} roomId="r1" autoText onTranslate={onTranslate} onRetry={vi.fn()} />);
    io.show(true);
    expect(onTranslate).toHaveBeenCalledTimes(1);
    expect(screen.queryByText("正在翻译…")).toBeNull();
    expect(screen.getByText("翻译没有完成")).toBeTruthy();
    onTranslate.mockReturnValue(true);
    fireEvent.click(screen.getByTestId("room-voice-translate-retry"));
    expect(onTranslate).toHaveBeenCalledTimes(2);
    expect(screen.getByText("正在翻译…")).toBeTruthy();
  });

  it("falls back to a retry when no answer arrives (rate limited or quota)", () => {
    vi.useFakeTimers();
    try {
      const io = stubIntersection();
      const onTranslate = vi.fn(() => true);
      renderWithProviders(<VoiceBubble message={message(voice())} mine={false} roomId="r1" autoText onTranslate={onTranslate} onRetry={vi.fn()} />);
      io.show(true);
      expect(screen.getByText("正在翻译…")).toBeTruthy();
      act(() => { vi.advanceTimersByTime(TRANSLATE_STALL_MS + 10); });
      expect(screen.queryByText("正在翻译…")).toBeNull();
      expect(screen.getByTestId("room-voice-translate-retry")).toBeTruthy();
      expect(onTranslate).toHaveBeenCalledTimes(1); // no automatic loop
    } finally {
      vi.useRealTimers();
    }
  });

  it("lets only the sender retry a failed transcription", () => {
    const onRetry = vi.fn();
    const failed = message(voice({ status: "failed", transcript: null }));
    const { unmount, rerender } = renderWithProviders(<VoiceBubble message={failed} mine roomId="r1" autoText={false} onTranslate={vi.fn()} onRetry={onRetry} />);
    expect(screen.getByText("转写失败")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "重试" }));
    expect(onRetry).toHaveBeenCalledWith(7);
    // review m1: no double frames while the retry is in flight
    expect(screen.getByRole("button", { name: "重试" })).toBeDisabled();
    rerender(<VoiceBubble message={message(voice({ status: "failed", transcript: null, attempts: 2 }))} mine roomId="r1" autoText={false} onTranslate={vi.fn()} onRetry={onRetry} />);
    expect(screen.getByRole("button", { name: "重试" })).not.toBeDisabled();
    // after 3 attempts the button is gone (mockup V8: at most 3)
    rerender(<VoiceBubble message={message(voice({ status: "failed", transcript: null, attempts: 3 }))} mine roomId="r1" autoText={false} onTranslate={vi.fn()} onRetry={onRetry} />);
    expect(screen.queryByRole("button", { name: "重试" })).toBeNull();
    unmount();
    renderWithProviders(<VoiceBubble message={failed} mine={false} roomId="r1" autoText={false} onTranslate={vi.fn()} onRetry={onRetry} />);
    expect(screen.queryByRole("button", { name: "重试" })).toBeNull();
  });

  it("says when nothing was heard", () => {
    renderWithProviders(<VoiceBubble message={message(voice({ status: "empty", transcript: null }))} mine roomId="r1" autoText={false} onTranslate={vi.fn()} onRetry={vi.fn()} />);
    expect(screen.getByText("没听清")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "翻译" })).toBeNull();
  });

  it("shows the translation when it arrives", () => {
    renderWithProviders(<VoiceBubble message={message(voice({ translation: "我去了那家新面馆。", translationStatus: "done" }))} mine roomId="r1" autoText={false} onTranslate={vi.fn()} onRetry={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "翻译" }));
    expect(screen.getByText("我去了那家新面馆。")).toBeTruthy();
  });

  it("disables playback when the audio was removed", () => {
    renderWithProviders(<VoiceBubble message={message(voice({ audio: false }))} mine roomId="r1" autoText={false} onTranslate={vi.fn()} onRetry={vi.fn()} />);
    expect(screen.getByTestId("room-voice-play")).toBeDisabled();
    expect(screen.getByText("音频已清理")).toBeTruthy();
  });

  it("fetches the audio only on tap and plays it", async () => {
    const play = vi.spyOn(HTMLMediaElement.prototype, "play").mockImplementation(() => Promise.resolve());
    vi.spyOn(HTMLMediaElement.prototype, "pause").mockImplementation(() => undefined);
    Object.assign(URL, { createObjectURL: vi.fn(() => "blob:voice"), revokeObjectURL: vi.fn() });
    const mock = createFetchMock({ "GET /api/rooms/r1/voice/m7": () => new Response(new Blob([new Uint8Array(8)], { type: "audio/mpeg" })) });
    const api = new ApiClient({ getToken: () => "t", fetchImpl: mock.fetch });
    renderWithProviders(<VoiceBubble message={message(voice())} mine={false} roomId="r1" autoText={false} onTranslate={vi.fn()} onRetry={vi.fn()} />, { api });
    expect(mock.calls).toHaveLength(0);
    const button = screen.getByTestId("room-voice-play");
    await act(async () => { fireEvent.click(button); });
    await waitFor(() => expect(button).toHaveAttribute("data-state", "playing"));
    expect(mock.calls).toHaveLength(1);
    expect(play).toHaveBeenCalled();
  });

  it("explains an audio file removed by an admin", async () => {
    vi.spyOn(HTMLMediaElement.prototype, "play").mockImplementation(() => Promise.resolve());
    vi.spyOn(HTMLMediaElement.prototype, "pause").mockImplementation(() => undefined);
    const mock = createFetchMock({ "GET /api/rooms/r1/voice/m7": () => json({ error: "Audio removed" }, 410) });
    const api = new ApiClient({ getToken: () => "t", fetchImpl: mock.fetch });
    renderWithProviders(<VoiceBubble message={message(voice())} mine={false} roomId="r1" autoText={false} onTranslate={vi.fn()} onRetry={vi.fn()} />, { api });
    await act(async () => { fireEvent.click(screen.getByTestId("room-voice-play")); });
    await waitFor(() => expect(screen.getByRole("alert").textContent).toBe("音频已被管理员清理"));
  });
});
