import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ApiClient } from "~/api/client";
import i18n from "~/i18n";
import type { RecordingResult, RecordingSession } from "~/audio/recorder";
import { createFetchMock, json } from "~/test/fetch-mock";
import { TestProviders } from "~/test/render";
import { useRoomVoice } from "./use-room-voice";

const wav = new Blob([new Uint8Array(44)], { type: "audio/wav" });
/** 录音会话:result 在 stop() 时才完成(立即完成的 result 会被 useRecorder 当成"录音自己结束了") */
function starter(cancel: () => void = vi.fn()) {
  return async (): Promise<RecordingSession> => {
    let done!: (r: RecordingResult) => void;
    const result = new Promise<RecordingResult>((resolve) => { done = resolve; });
    const stop = () => { done({ blob: wav, mimeType: "audio/wav", durationMs: 2000, stoppedBy: "user" }); return result; };
    return { startedAt: 0, result, stop, cancel };
  };
}

function setup(target: "group" | "assist", routes: Parameters<typeof createFetchMock>[0], over: { enabled?: boolean; cancel?: () => void } = {}) {
  const mock = createFetchMock(routes);
  const api = new ApiClient({ getToken: () => "t", fetchImpl: mock.fetch });
  const cb = { onFill: vi.fn(), onAssistDraft: vi.fn(), onSent: vi.fn(), onActivity: vi.fn() };
  const hook = renderHook(() => useRoomVoice({ roomId: "r1", enabled: over.enabled ?? true, maxMs: 60000, target, replyTo: 4,
    starter: starter(over.cancel ?? vi.fn()), newId: () => "c1", ...cb }),
  { wrapper: ({ children }) => <TestProviders api={api}>{children}</TestProviders> });
  return { hook, mock, cb };
}

describe("useRoomVoice", () => {
  beforeEach(() => { localStorage.setItem("enjoy-web.settings", JSON.stringify({ language: "zh-CN" })); });
  afterEach(async () => { localStorage.removeItem("enjoy-web.settings"); await i18n.changeLanguage("en"); });

  it("sends audio to the room with the quote and reports activity", async () => {
    const message = { seq: 5, id: "m5", kind: "voice" };
    const { hook, mock, cb } = setup("group", { "POST /api/rooms/r1/voice": () => json({ seq: 5, message }) });
    await act(async () => { expect(await hook.result.current.start()).toBe(true); });
    expect(cb.onActivity).toHaveBeenLastCalledWith("recording");
    expect(hook.result.current.state).toBe("recording");
    act(() => hook.result.current.finish("send"));
    await waitFor(() => expect(cb.onSent).toHaveBeenCalled());
    expect(cb.onSent.mock.calls[0][0]).toMatchObject({ seq: 5, id: "m5" });
    const form = mock.calls[0].body as FormData;
    expect(form.get("client_id")).toBe("c1");
    expect(form.get("reply_to")).toBe("4");
    expect((form.get("file") as File).name).toBe("voice.wav");
    expect(cb.onActivity).toHaveBeenLastCalledWith("idle");
    await waitFor(() => expect(hook.result.current.state).toBe("idle"));
  });

  it("slide-to-text fills the composer without uploading", async () => {
    const { hook, mock, cb } = setup("group", { "POST /api/ai/audio/transcriptions": () => json({ text: "I like noodles" }) });
    await act(async () => { await hook.result.current.start(); });
    act(() => hook.result.current.finish("fill"));
    await waitFor(() => expect(cb.onFill).toHaveBeenCalledWith("I like noodles"));
    expect(mock.calls.some((c) => c.url.pathname.endsWith("/voice"))).toBe(false);
    // 不带语言提示:保留原语言
    expect((mock.calls[0].body as FormData).get("language")).toBeNull();
  });

  it("while the assistant is the target, voice becomes an assistant draft", async () => {
    const { hook, cb } = setup("assist", { "POST /api/ai/audio/transcriptions": () => json({ text: "我要一杯拿铁" }) });
    await act(async () => { await hook.result.current.start(); });
    act(() => hook.result.current.finish("send"));
    await waitFor(() => expect(cb.onAssistDraft).toHaveBeenCalledWith("我要一杯拿铁"));
    expect(cb.onSent).not.toHaveBeenCalled();
    // 对助手说的话不广播"正在说话"
    expect(cb.onActivity).not.toHaveBeenCalledWith("recording");
  });

  it("maps server errors", async () => {
    const { hook } = setup("group", { "POST /api/rooms/r1/voice": () => json({ error: "Voice storage quota reached" }, 429) });
    await act(async () => { await hook.result.current.start(); });
    act(() => hook.result.current.finish("send"));
    await waitFor(() => expect(hook.result.current.error).toBe("今天的语音存储额度已用完,可以继续发文字"));
    expect(hook.result.current.state).toBe("idle");
  });

  it("an empty transcription does not fill the composer", async () => {
    const { hook, cb } = setup("group", { "POST /api/ai/audio/transcriptions": () => json({ text: "  " }) });
    await act(async () => { await hook.result.current.start(); });
    act(() => hook.result.current.finish("fill"));
    await waitFor(() => expect(hook.result.current.error).toBe("没听清,再说一次"));
    expect(cb.onFill).not.toHaveBeenCalled();
  });

  it("discard releases the microphone without uploading", async () => {
    const cancel = vi.fn();
    const { hook, mock, cb } = setup("group", {}, { cancel });
    await act(async () => { await hook.result.current.start(); });
    act(() => hook.result.current.discard("slide"));
    expect(cancel).toHaveBeenCalled();
    expect(cb.onActivity).toHaveBeenLastCalledWith("idle");
    expect(mock.calls).toHaveLength(0);
    expect(hook.result.current.state).toBe("idle");
  });

  it("sends when the recorder stops itself at the limit, drops an interrupted recording", async () => {
    for (const stoppedBy of ["max_duration", "background"] as const) {
      let done!: (r: RecordingResult) => void;
      const auto = async (): Promise<RecordingSession> => {
        const result = new Promise<RecordingResult>((resolve) => { done = resolve; });
        return { startedAt: 0, result, stop: () => result, cancel: vi.fn() };
      };
      const mock = createFetchMock({ "POST /api/rooms/r1/voice": () => json({ seq: 5, message: { seq: 5, id: "m5" } }) });
      const api = new ApiClient({ getToken: () => "t", fetchImpl: mock.fetch });
      const onSent = vi.fn();
      const hook = renderHook(() => useRoomVoice({ roomId: "r1", enabled: true, maxMs: 60000, target: "group", replyTo: null, starter: auto,
        onFill: vi.fn(), onAssistDraft: vi.fn(), onSent, onActivity: vi.fn() }),
      { wrapper: ({ children }) => <TestProviders api={api}>{children}</TestProviders> });
      await act(async () => { await hook.result.current.start(); });
      await act(async () => { done({ blob: wav, mimeType: "audio/wav", durationMs: 60000, stoppedBy }); });
      if (stoppedBy === "max_duration") {
        await waitFor(() => expect(onSent).toHaveBeenCalled());
        expect((mock.calls[0].body as FormData).get("reply_to")).toBeNull();
      } else {
        await waitFor(() => expect(hook.result.current.error).toBe("录音被打断,这段没有发送"));
        expect(mock.calls).toHaveLength(0);
      }
      hook.unmount();
    }
  });

  it("does nothing while voice is disabled", async () => {
    const { hook, cb } = setup("group", {}, { enabled: false });
    await act(async () => { expect(await hook.result.current.start()).toBe(false); });
    expect(cb.onActivity).not.toHaveBeenCalled();
  });

  it("keeps telling the room someone is speaking while the recording lasts (review M4)", async () => {
    vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"] });
    try {
      const { hook, cb } = setup("group", {});
      await act(async () => { await hook.result.current.start(); });
      expect(hook.result.current.state).toBe("recording");
      const count = () => cb.onActivity.mock.calls.filter(([s]) => s === "recording").length;
      expect(count()).toBe(1);
      act(() => { vi.advanceTimersByTime(20_000); }); // receivers drop it after 6 s without a refresh
      expect(count()).toBeGreaterThanOrEqual(6);
      act(() => hook.result.current.discard("slide"));
      const after = count();
      act(() => { vi.advanceTimersByTime(10_000); });
      expect(count()).toBe(after);
      expect(cb.onActivity).toHaveBeenLastCalledWith("idle");
    } finally {
      vi.useRealTimers();
    }
  });

  it("keeps a failed upload for a retry with the same client id, or discards it (review M9)", async () => {
    let fail = true;
    const message = { seq: 5, id: "m5", kind: "voice" };
    const mock = createFetchMock({ "POST /api/rooms/r1/voice": () => (fail ? json({ error: "Bad gateway" }, 502) : json({ seq: 5, message })) });
    const api = new ApiClient({ getToken: () => "t", fetchImpl: mock.fetch });
    let n = 0;
    const onSent = vi.fn();
    const hook = renderHook(() => useRoomVoice({ roomId: "r1", enabled: true, maxMs: 60000, target: "group", replyTo: 4, starter: starter(),
      newId: () => `c${(n += 1)}`, onFill: vi.fn(), onAssistDraft: vi.fn(), onSent, onActivity: vi.fn() }),
    { wrapper: ({ children }) => <TestProviders api={api}>{children}</TestProviders> });
    await act(async () => { await hook.result.current.start(); });
    act(() => hook.result.current.finish("send"));
    await waitFor(() => expect(hook.result.current.failed).toBe(true));
    expect(hook.result.current.error).toBeTruthy();
    fail = false;
    act(() => hook.result.current.retryUpload());
    await waitFor(() => expect(onSent).toHaveBeenCalled());
    const ids = mock.calls.map((c) => (c.body as FormData).get("client_id"));
    expect(ids).toEqual(["c1", "c1"]); // the server's 5-minute dedupe makes a retry after a lost response safe
    expect((mock.calls[1].body as FormData).get("reply_to")).toBe("4");
    expect(hook.result.current.failed).toBe(false);
    // a validation error is final: nothing to retry
    const bad = createFetchMock({ "POST /api/rooms/r1/voice": () => json({ error: "Audio too short" }, 400) });
    const api2 = new ApiClient({ getToken: () => "t", fetchImpl: bad.fetch });
    const hook2 = renderHook(() => useRoomVoice({ roomId: "r1", enabled: true, maxMs: 60000, target: "group", replyTo: null, starter: starter(),
      onFill: vi.fn(), onAssistDraft: vi.fn(), onSent: vi.fn(), onActivity: vi.fn() }),
    { wrapper: ({ children }) => <TestProviders api={api2}>{children}</TestProviders> });
    await act(async () => { await hook2.result.current.start(); });
    act(() => hook2.result.current.finish("send"));
    await waitFor(() => expect(hook2.result.current.error).toBe("说话时间太短"));
    expect(hook2.result.current.failed).toBe(false);
  });

  it("discarding a failed upload forgets it", async () => {
    const { hook } = setup("group", { "POST /api/rooms/r1/voice": () => json({ error: "Bad gateway" }, 503) });
    await act(async () => { await hook.result.current.start(); });
    act(() => hook.result.current.finish("send"));
    await waitFor(() => expect(hook.result.current.failed).toBe(true));
    act(() => hook.result.current.discardFailed());
    expect(hook.result.current.failed).toBe(false);
    expect(hook.result.current.error).toBeNull();
  });
});
