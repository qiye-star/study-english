import { StrictMode, type ReactNode } from "react";
import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ApiClient } from "~/api/client";
import { toAssessmentWav } from "~/audio/convert";
import { abortLatencyTrace, finishLatencyTrace, latencyLog, resetLatencyForTest, startLatencyTrace } from "~/lib/latency";
import { createFakeRecorderEnv } from "~/test/fake-media";
import { createFetchMock, json, type Handler } from "~/test/fetch-mock";
import { VOICE_MAX_MS, useVoiceTurn, type VoiceDraftEvent } from "./use-voice-turn";
import { encodeWavPcm16 } from "~/audio/wav";

vi.mock("~/audio/convert", async (importOriginal) => ({
  ...(await importOriginal<typeof import("~/audio/convert")>()),
  toAssessmentWav: vi.fn(async () => ({ wav: new Blob(["RIFF"], { type: "audio/wav" }), durationMs: 1000 })),
}));

interface SetupOptions {
  strict?: boolean;
  envOverrides?: Parameters<typeof createFakeRecorderEnv>[0];
}

function setup(route: Handler, options: SetupOptions = {}) {
  const mock = createFetchMock({ "POST /api/ai/audio/transcriptions": route });
  const fake = createFakeRecorderEnv(options.envOverrides);
  const events: VoiceDraftEvent[] = [];
  const onTranscribed = vi.fn();
  let n = 0;
  const urls = { create: vi.fn(() => `blob:${++n}`), revoke: vi.fn() };
  const wrapper = options.strict ? ({ children }: { children: ReactNode }) => <StrictMode>{children}</StrictMode> : undefined;
  const hook = renderHook(
    () =>
      useVoiceTurn({
        api: new ApiClient({ getToken: () => "t", fetchImpl: mock.fetch }),
        env: fake.env,
        newKey: () => "v1",
        onDraft: (e) => events.push(e),
        onTranscribed,
        urls,
      }),
    { wrapper },
  );
  return { ...hook, mock, fake, events, onTranscribed, urls };
}

function deferred<T>() {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((r) => (resolve = r));
  return { promise, resolve };
}

const flush = () => act(async () => { await new Promise((r) => setTimeout(r, 10)); });

describe("useVoiceTurn", () => {
  beforeEach(() => vi.mocked(toAssessmentWav).mockClear());

  it("records, transcribes without a language hint and hands over the clip", async () => {
    const t = setup(() => json({ text: "  Hello there  " }));
    await act(async () => { await t.result.current.start(); });
    expect(t.result.current.state).toBe("recording");
    await act(async () => { await t.result.current.stop(); });
    await waitFor(() => expect(t.onTranscribed).toHaveBeenCalled());
    expect(t.events[0]).toEqual({ kind: "transcribing", key: "v1", durationMs: expect.any(Number) });
    const [clip, text] = t.onTranscribed.mock.calls[0];
    expect(text).toBe("Hello there");
    expect(clip).toMatchObject({ key: "v1", durationMs: 1000, audioUrl: "blob:1" });
    expect(clip.wav).toBeInstanceOf(Blob);
    expect((t.mock.calls[0].body as FormData).has("language")).toBe(false);
    expect(t.fake.track.stop).toHaveBeenCalled();
    expect(t.result.current.state).toBe("idle");
  });

  it("cancel discards the recording, releases the mic and sends nothing", async () => {
    const t = setup(() => json({ text: "x" }));
    await act(async () => { await t.result.current.start(); });
    act(() => t.result.current.cancel());
    await act(async () => { await Promise.resolve(); });
    expect(t.fake.track.stop).toHaveBeenCalled();
    expect(t.events).toEqual([]);
    expect(t.mock.calls).toHaveLength(0);
    expect(t.result.current.state).toBe("idle");
  });

  it("keeps a failed draft and retries with the already converted WAV", async () => {
    let attempt = 0;
    const t = setup(() => (++attempt === 1 ? json({ error: "Upstream unavailable" }, 502) : json({ text: "Second try" })));
    await act(async () => { await t.result.current.start(); });
    await act(async () => { await t.result.current.stop(); });
    await waitFor(() => expect(t.events.at(-1)).toEqual({ kind: "failed", key: "v1", error: "The AI service is unavailable. Please try again." }));
    expect(t.result.current.state).toBe("idle");
    act(() => t.result.current.retry("v1"));
    await waitFor(() => expect(t.onTranscribed).toHaveBeenCalledWith(expect.objectContaining({ key: "v1" }), "Second try"));
    expect(toAssessmentWav).toHaveBeenCalledTimes(1);
  });

  it("reports an empty transcript as no speech and keeps the draft retryable", async () => {
    const t = setup(() => json({ text: "  " }));
    await act(async () => { await t.result.current.start(); });
    await act(async () => { await t.result.current.stop(); });
    await waitFor(() => expect(t.events.at(-1)).toEqual({ kind: "failed", key: "v1", error: "No speech was recognized." }));
    expect(t.onTranscribed).not.toHaveBeenCalled();
    expect(t.result.current.state).toBe("idle");
  });

  it("keeps a recording cut by going to the background until the user sends it", async () => {
    const t = setup(() => json({ text: "Kept words" }));
    await act(async () => { await t.result.current.start(); });
    act(() => t.fake.setHidden());
    await waitFor(() => expect(t.events.at(-1)).toMatchObject({ kind: "kept", key: "v1" }));
    expect(t.mock.calls).toHaveLength(0);
    expect(t.result.current.state).toBe("idle");
    act(() => t.result.current.retry("v1"));
    await waitFor(() => expect(t.onTranscribed).toHaveBeenCalledWith(expect.anything(), "Kept words"));
  });

  it("keeps a recording cut by mic loss as a draft", async () => {
    const t = setup(() => json({ text: "Mic words" }));
    await act(async () => { await t.result.current.start(); });
    act(() => t.fake.track.fireEnded());
    await waitFor(() => expect(t.events.at(-1)).toMatchObject({ kind: "kept", key: "v1" }));
    expect(t.mock.calls).toHaveLength(0);
  });

  it("discard drops a kept draft so it can no longer be sent", async () => {
    const t = setup(() => json({ text: "x" }));
    await act(async () => { await t.result.current.start(); });
    act(() => t.fake.setHidden());
    await waitFor(() => expect(t.events.at(-1)).toMatchObject({ kind: "kept" }));
    act(() => t.result.current.discard("v1"));
    act(() => t.result.current.retry("v1"));
    await flush();
    expect(t.mock.calls).toHaveLength(0);
    expect(t.result.current.state).toBe("idle");
  });

  it("sends automatically at the 60-second limit", async () => {
    expect(VOICE_MAX_MS).toBe(60_000);
    const t = setup(() => json({ text: "Long talk" }));
    await act(async () => { await t.result.current.start(); });
    act(() => t.fake.fireTimer());
    await waitFor(() => expect(t.onTranscribed).toHaveBeenCalledWith(expect.anything(), "Long talk"));
  });

  it("aborts the transcription on unmount and reports nothing afterwards", async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const t = setup(async () => { await gate; return json({ text: "late" }); });
    await act(async () => { await t.result.current.start(); });
    await act(async () => { await t.result.current.stop(); });
    await waitFor(() => expect(t.mock.calls).toHaveLength(1));
    t.unmount();
    expect(t.mock.calls[0].signal?.aborted).toBe(true);
    release();
    await new Promise((r) => setTimeout(r, 10));
    expect(t.onTranscribed).not.toHaveBeenCalled();
  });

  it("releases the mic when unmounted while recording, and revokes clip URLs on reset", async () => {
    const t = setup(() => json({ text: "Hi there friend" }));
    await act(async () => { await t.result.current.start(); });
    await act(async () => { await t.result.current.stop(); });
    await waitFor(() => expect(t.onTranscribed).toHaveBeenCalled());
    act(() => t.result.current.reset());
    expect(t.urls.revoke).toHaveBeenCalledWith("blob:1");
    await act(async () => { await t.result.current.start(); });
    t.unmount();
    await Promise.resolve();
    await Promise.resolve();
    expect(t.fake.track.stop).toHaveBeenCalledTimes(2);
  });

  describe("state machine hazards", () => {
    it("ignores a second start while recording or starting", async () => {
      const t = setup(() => json({ text: "x" }));
      await act(async () => {
        const [a, b] = await Promise.all([t.result.current.start(), t.result.current.start()]);
        expect([a, b].filter(Boolean)).toHaveLength(1);
      });
      await act(async () => { expect(await t.result.current.start()).toBe(false); });
      expect(t.fake.constraints).toHaveLength(1);
    });

    it("never starts a new recording while the previous stop() has not settled", async () => {
      const t = setup(() => json({ text: "x" }));
      t.fake.behavior.silentStop = true; // stop() only settles via the fallback timer
      await act(async () => { await t.result.current.start(); });
      let stopped!: Promise<void>;
      act(() => { stopped = t.result.current.stop(); });
      expect(t.result.current.state).toBe("processing");
      await act(async () => { expect(await t.result.current.start()).toBe(false); });
      expect(t.fake.constraints).toHaveLength(1);
      await act(async () => { t.fake.fireTimer(); await stopped; });
      await waitFor(() => expect(t.onTranscribed).toHaveBeenCalled());
      expect(t.fake.constraints).toHaveLength(1);
      await act(async () => { expect(await t.result.current.start()).toBe(true); });
      expect(t.fake.constraints).toHaveLength(2);
    });

    it("ignores start and a second stop while transcribing; start works once idle", async () => {
      const gate = deferred<void>();
      const t = setup(async () => { await gate.promise; return json({ text: "Hello" }); });
      await act(async () => { await t.result.current.start(); });
      await act(async () => { await t.result.current.stop(); });
      await waitFor(() => expect(t.result.current.state).toBe("processing"));
      await act(async () => { expect(await t.result.current.start()).toBe(false); });
      await act(async () => { await t.result.current.stop(); });
      expect(t.fake.constraints).toHaveLength(1);
      await act(async () => { gate.resolve(); });
      await waitFor(() => expect(t.result.current.state).toBe("idle"));
      await act(async () => { expect(await t.result.current.start()).toBe(true); });
    });

    it("cancel while stopping discards the clip and releases the mic", async () => {
      const t = setup(() => json({ text: "x" }));
      t.fake.behavior.silentStop = true;
      await act(async () => { await t.result.current.start(); });
      let stopped!: Promise<void>;
      act(() => { stopped = t.result.current.stop(); });
      act(() => t.result.current.cancel());
      expect(t.fake.track.stop).toHaveBeenCalled();
      await act(async () => { t.fake.fireTimer(); await stopped; });
      await flush();
      expect(t.events).toEqual([]);
      expect(t.mock.calls).toHaveLength(0);
      expect(t.result.current.state).toBe("idle");
    });

    it("cancel while starting releases the mic once it arrives and sends nothing", async () => {
      const mic = deferred<void>();
      const holder: { track?: unknown } = {};
      const t = setup(() => json({ text: "x" }), {
        envOverrides: { getUserMedia: async () => { await mic.promise; return { getTracks: () => [holder.track] } as unknown as MediaStream; } },
      });
      holder.track = t.fake.track;
      let started!: Promise<boolean>;
      act(() => { started = t.result.current.start(); });
      expect(t.result.current.state).toBe("starting");
      act(() => t.result.current.cancel());
      await act(async () => { mic.resolve(); await started; });
      expect(t.fake.track.stop).toHaveBeenCalled();
      expect(t.result.current.state).toBe("idle");
      expect(t.events).toEqual([]);
    });

    it("stop('discard') while starting (permission prompt open) releases the mic once it arrives", async () => {
      const mic = deferred<void>();
      const holder: { track?: unknown } = {};
      const t = setup(() => json({ text: "x" }), {
        envOverrides: { getUserMedia: async () => { await mic.promise; return { getTracks: () => [holder.track] } as unknown as MediaStream; } },
      });
      holder.track = t.fake.track;
      let started!: Promise<boolean>;
      act(() => { started = t.result.current.start(); });
      expect(t.result.current.state).toBe("starting");
      await act(async () => { await t.result.current.stop("discard"); });
      await act(async () => { mic.resolve(); await started; });
      expect(t.fake.track.stop).toHaveBeenCalled();
      expect(t.result.current.state).toBe("idle");
      expect(t.events).toEqual([]);
      expect(t.mock.calls).toHaveLength(0);
    });

    it("stop('discard') right after start(), before React re-rendered, still releases the mic", async () => {
      const mic = deferred<void>();
      const holder: { track?: unknown } = {};
      const t = setup(() => json({ text: "x" }), {
        envOverrides: { getUserMedia: async () => { await mic.promise; return { getTracks: () => [holder.track] } as unknown as MediaStream; } },
      });
      holder.track = t.fake.track;
      let started!: Promise<boolean>;
      await act(async () => {
        started = t.result.current.start();
        await t.result.current.stop("discard"); // 同一个事件里:recorderState 还没更新
        mic.resolve();
        await started;
      });
      expect(t.fake.track.stop).toHaveBeenCalled();
      expect(t.result.current.state).toBe("idle");
    });

    it("cancel while transcribing aborts the request, discards the draft and reports nothing as transcribed", async () => {
      const gate = deferred<void>();
      const t = setup(async () => { await gate.promise; return json({ text: "late" }); });
      await act(async () => { await t.result.current.start(); });
      await act(async () => { await t.result.current.stop(); });
      await waitFor(() => expect(t.mock.calls).toHaveLength(1));
      act(() => t.result.current.cancel());
      expect(t.mock.calls[0].signal?.aborted).toBe(true);
      expect(t.result.current.state).toBe("idle");
      expect(t.events.at(-1)).toEqual({ kind: "discarded", key: "v1" });
      await act(async () => { gate.resolve(); });
      await flush();
      expect(t.onTranscribed).not.toHaveBeenCalled();
      act(() => t.result.current.retry("v1"));
      await flush();
      expect(t.mock.calls).toHaveLength(1);
    });

    it("cancel while converting never reaches the network", async () => {
      const conv = deferred<{ wav: Blob; durationMs: number }>();
      vi.mocked(toAssessmentWav).mockImplementationOnce(() => conv.promise);
      const t = setup(() => json({ text: "x" }));
      await act(async () => { await t.result.current.start(); });
      await act(async () => { await t.result.current.stop(); });
      expect(t.result.current.state).toBe("processing");
      act(() => t.result.current.cancel());
      await act(async () => { conv.resolve({ wav: new Blob(["RIFF"]), durationMs: 5 }); });
      await flush();
      expect(t.mock.calls).toHaveLength(0);
      expect(t.onTranscribed).not.toHaveBeenCalled();
      expect(t.result.current.state).toBe("idle");
    });

    it("a failed conversion keeps the recording and retry converts again", async () => {
      vi.mocked(toAssessmentWav).mockRejectedValueOnce(new Error("decode"));
      const t = setup(() => json({ text: "Recovered" }));
      await act(async () => { await t.result.current.start(); });
      await act(async () => { await t.result.current.stop(); });
      await waitFor(() => expect(t.events.at(-1)).toMatchObject({ kind: "failed", key: "v1" }));
      act(() => t.result.current.retry("v1"));
      await waitFor(() => expect(t.onTranscribed).toHaveBeenCalledWith(expect.anything(), "Recovered"));
      expect(toAssessmentWav).toHaveBeenCalledTimes(2);
    });

    it("a retry while a transcription is in flight is ignored", async () => {
      const gate = deferred<void>();
      const t = setup(async () => { await gate.promise; return json({ text: "once" }); });
      await act(async () => { await t.result.current.start(); });
      await act(async () => { await t.result.current.stop(); });
      await waitFor(() => expect(t.mock.calls).toHaveLength(1));
      act(() => t.result.current.retry("v1"));
      await act(async () => { gate.resolve(); });
      await waitFor(() => expect(t.onTranscribed).toHaveBeenCalledTimes(1));
      expect(t.mock.calls).toHaveLength(1);
    });

    it("an onTranscribed error is not a transcription failure: logs, keeps the draft and can be sent again", async () => {
      const spy = vi.spyOn(console, "error").mockImplementation(() => {});
      const t = setup(() => json({ text: "Hello" }));
      t.onTranscribed.mockImplementationOnce(() => { throw new Error("page boom"); });
      await act(async () => { await t.result.current.start(); });
      await act(async () => { await t.result.current.stop(); });
      await waitFor(() => expect(t.events.at(-1)).toMatchObject({ kind: "kept", key: "v1" }));
      expect(t.events.some((e) => e.kind === "failed")).toBe(false);
      expect(spy).toHaveBeenCalled();
      expect(t.result.current.state).toBe("idle");
      act(() => t.result.current.retry("v1"));
      await waitFor(() => expect(t.onTranscribed).toHaveBeenCalledTimes(2));
      expect(t.onTranscribed).toHaveBeenLastCalledWith(expect.objectContaining({ key: "v1" }), "Hello");
      // the retry only hands over again: no second upload/transcription, no second blob URL
      expect(t.mock.calls).toHaveLength(1);
      expect(t.urls.create).toHaveBeenCalledTimes(1);
      expect(t.onTranscribed.mock.calls[1][0].audioUrl).toBe(t.onTranscribed.mock.calls[0][0].audioUrl);
      spy.mockRestore();
    });

    it("cancel then an immediate start() works while the old stop() has not settled, and the old clip is dropped", async () => {
      const t = setup(() => json({ text: "x" }));
      t.fake.behavior.silentStop = true;
      await act(async () => { await t.result.current.start(); });
      let stopped!: Promise<void>;
      act(() => { stopped = t.result.current.stop(); });
      act(() => t.result.current.cancel());
      await act(async () => { expect(await t.result.current.start()).toBe(true); });
      expect(t.fake.constraints).toHaveLength(2);
      expect(t.result.current.state).toBe("recording");
      await act(async () => { t.fake.fireTimer(); await stopped; });
      await flush();
      expect(t.onTranscribed).not.toHaveBeenCalled();
      expect(t.mock.calls).toHaveLength(0);
    });

    it("retry() while recording is ignored", async () => {
      let attempt = 0;
      const t = setup(() => (++attempt === 1 ? json({ error: "Upstream unavailable" }, 502) : json({ text: "ok" })));
      await act(async () => { await t.result.current.start(); });
      await act(async () => { await t.result.current.stop(); });
      await waitFor(() => expect(t.events.at(-1)).toMatchObject({ kind: "failed", key: "v1" }));
      await act(async () => { await t.result.current.start(); });
      expect(t.result.current.state).toBe("recording");
      act(() => t.result.current.retry("v1"));
      await flush();
      expect(t.mock.calls).toHaveLength(1);
      expect(t.result.current.state).toBe("recording");
    });

    it("discard(key) aborts the in-flight transcription and never hands it over", async () => {
      const gate = deferred<void>();
      const t = setup(async () => { await gate.promise; return json({ text: "late" }); });
      await act(async () => { await t.result.current.start(); });
      await act(async () => { await t.result.current.stop(); });
      await waitFor(() => expect(t.mock.calls).toHaveLength(1));
      act(() => t.result.current.discard("v1"));
      expect(t.mock.calls[0].signal?.aborted).toBe(true);
      expect(t.result.current.state).toBe("idle");
      await act(async () => { gate.resolve(); });
      await flush();
      expect(t.onTranscribed).not.toHaveBeenCalled();
      expect(t.events.some((e) => e.kind === "failed")).toBe(false);
    });

    it("a transcribed draft cannot be re-sent (no re-upload once handed over)", async () => {
      const t = setup(() => json({ text: "Done" }));
      await act(async () => { await t.result.current.start(); });
      await act(async () => { await t.result.current.stop(); });
      await waitFor(() => expect(t.onTranscribed).toHaveBeenCalledTimes(1));
      act(() => t.result.current.retry("v1"));
      await flush();
      expect(t.mock.calls).toHaveLength(1);
      expect(t.onTranscribed).toHaveBeenCalledTimes(1);
    });

    it("exposes the flags the page needs", async () => {
      const gate = deferred<void>();
      const t = setup(async () => { await gate.promise; return json({ text: "Hello" }); });
      expect(t.result.current.blocksTyping).toBe(false);
      expect(t.result.current.canStop).toBe(false);
      await act(async () => { await t.result.current.start(); });
      expect(t.result.current.blocksTyping).toBe(true);
      expect(t.result.current.canStop).toBe(true);
      await act(async () => { await t.result.current.stop(); });
      await waitFor(() => expect(t.result.current.state).toBe("processing"));
      expect(t.result.current.blocksTyping).toBe(true);
      expect(t.result.current.canStop).toBe(false);
      await act(async () => { gate.resolve(); });
      await waitFor(() => expect(t.result.current.blocksTyping).toBe(false));
    });

    it("reset aborts an in-flight transcription and forgets drafts", async () => {
      const gate = deferred<void>();
      const t = setup(async () => { await gate.promise; return json({ text: "late" }); });
      await act(async () => { await t.result.current.start(); });
      await act(async () => { await t.result.current.stop(); });
      await waitFor(() => expect(t.mock.calls).toHaveLength(1));
      act(() => t.result.current.reset());
      expect(t.mock.calls[0].signal?.aborted).toBe(true);
      expect(t.result.current.state).toBe("idle");
      await act(async () => { gate.resolve(); });
      await flush();
      expect(t.onTranscribed).not.toHaveBeenCalled();
    });
  });

  describe("unmount in every state", () => {
    it("while starting: the mic is released when it arrives", async () => {
      const mic = deferred<void>();
      const holder: { track?: { stop: ReturnType<typeof vi.fn> } } = {};
      const t = setup(() => json({ text: "x" }), {
        envOverrides: { getUserMedia: async () => { await mic.promise; return { getTracks: () => [holder.track] } as unknown as MediaStream; } },
      });
      holder.track = t.fake.track;
      let started!: Promise<boolean>;
      act(() => { started = t.result.current.start(); });
      t.unmount();
      await act(async () => { mic.resolve(); await started; });
      expect(t.fake.track.stop).toHaveBeenCalled();
    });

    it("while stopping: the mic is released even if stop never completes", async () => {
      const t = setup(() => json({ text: "x" }));
      t.fake.behavior.silentStop = true;
      await act(async () => { await t.result.current.start(); });
      act(() => { void t.result.current.stop(); });
      t.unmount();
      expect(t.fake.track.stop).toHaveBeenCalled();
      t.fake.fireTimer();
      await flush();
      expect(t.events).toEqual([]);
      expect(t.mock.calls).toHaveLength(0);
    });

    it("while converting: no request is made and nothing is reported", async () => {
      const conv = deferred<{ wav: Blob; durationMs: number }>();
      vi.mocked(toAssessmentWav).mockImplementationOnce(() => conv.promise);
      const t = setup(() => json({ text: "x" }));
      await act(async () => { await t.result.current.start(); });
      await act(async () => { await t.result.current.stop(); });
      t.unmount();
      conv.resolve({ wav: new Blob(["RIFF"]), durationMs: 5 });
      await new Promise((r) => setTimeout(r, 10));
      expect(t.mock.calls).toHaveLength(0);
      expect(t.onTranscribed).not.toHaveBeenCalled();
    });

    it("with a failed draft: a late failure after unmount is not reported and URLs are revoked", async () => {
      const gate = deferred<void>();
      const t = setup(async () => { await gate.promise; return json({ error: "x" }, 502); });
      await act(async () => { await t.result.current.start(); });
      await act(async () => { await t.result.current.stop(); });
      await waitFor(() => expect(t.mock.calls).toHaveLength(1));
      const before = t.events.length;
      t.unmount();
      gate.resolve();
      await new Promise((r) => setTimeout(r, 10));
      expect(t.events).toHaveLength(before);
    });

    it("after a transcription: clip URLs are revoked", async () => {
      const t = setup(() => json({ text: "Hello" }));
      await act(async () => { await t.result.current.start(); });
      await act(async () => { await t.result.current.stop(); });
      await waitFor(() => expect(t.onTranscribed).toHaveBeenCalled());
      t.unmount();
      expect(t.urls.revoke).toHaveBeenCalledWith("blob:1");
    });
  });

  describe("StrictMode", () => {
    it("survives the double mount and transcribes exactly once", async () => {
      const t = setup(() => json({ text: "Strict hello" }), { strict: true });
      await act(async () => { await t.result.current.start(); });
      expect(t.result.current.state).toBe("recording");
      await act(async () => { await t.result.current.stop(); });
      await waitFor(() => expect(t.onTranscribed).toHaveBeenCalledTimes(1));
      expect(t.mock.calls).toHaveLength(1);
      expect(t.mock.calls[0].signal?.aborted).toBe(false);
      expect(t.result.current.state).toBe("idle");
    });

    it("still releases the mic on unmount", async () => {
      const t = setup(() => json({ text: "x" }), { strict: true });
      await act(async () => { await t.result.current.start(); });
      t.unmount();
      await flush();
      expect(t.fake.track.stop).toHaveBeenCalled();
    });
  });
});

describe("latency traces per turn", () => {
  beforeEach(() => resetLatencyForTest());

  async function recordAndStop(t: ReturnType<typeof setup>) {
    await act(async () => { await t.result.current.start(); });
    await act(async () => { await t.result.current.stop(); });
  }

  it("a successful transcription leaves the trace open with release, audio_ready and transcript", async () => {
    const t = setup(() => json({ text: "Hello" }));
    await recordAndStop(t);
    await waitFor(() => expect(t.onTranscribed).toHaveBeenCalled());
    expect(latencyLog()).toHaveLength(0); // 还在等回复
    finishLatencyTrace("aborted");
    expect(Object.keys(latencyLog()[0].marks).sort()).toEqual(["audio_ready", "release", "transcript"]);
  });

  it("no speech aborts the trace", async () => {
    const t = setup(() => json({ text: " " }));
    await recordAndStop(t);
    await waitFor(() => expect(t.events.at(-1)).toMatchObject({ kind: "failed" }));
    expect(latencyLog().map((r) => r.status)).toEqual(["aborted"]);
  });

  it("a transcription error aborts the trace, and the retry opens a fresh one", async () => {
    let attempt = 0;
    const t = setup(() => (++attempt === 1 ? json({ error: "Upstream unavailable" }, 502) : json({ text: "Second" })));
    await recordAndStop(t);
    await waitFor(() => expect(t.events.at(-1)).toMatchObject({ kind: "failed" }));
    expect(latencyLog().map((r) => r.status)).toEqual(["aborted"]);
    act(() => t.result.current.retry("v1"));
    await waitFor(() => expect(t.onTranscribed).toHaveBeenCalled());
    abortLatencyTrace();
    const [first, second] = latencyLog();
    expect(second.id).not.toBe(first.id);
    expect(second.marks.release).toBeDefined();
    expect(second.marks.transcript).toBeDefined();
  });

  it("a kept draft (background) has no trace until it is sent", async () => {
    const t = setup(() => json({ text: "Kept" }));
    await act(async () => { await t.result.current.start(); });
    act(() => t.fake.setHidden());
    await waitFor(() => expect(t.events.at(-1)).toMatchObject({ kind: "kept" }));
    expect(latencyLog()).toHaveLength(0);
    act(() => t.result.current.retry("v1"));
    await waitFor(() => expect(t.onTranscribed).toHaveBeenCalled());
    finishLatencyTrace("aborted");
    expect(latencyLog()).toHaveLength(1);
    expect(latencyLog()[0].marks.transcript).toBeDefined();
  });

  it("an aborted transcription (cancel) aborts the trace", async () => {
    const gate = deferred<Response>();
    const t = setup(() => gate.promise as never);
    await recordAndStop(t);
    await waitFor(() => expect(t.mock.calls).toHaveLength(1));
    act(() => t.result.current.cancel());
    expect(latencyLog().map((r) => r.status)).toEqual(["aborted"]);
    gate.resolve(json({ text: "late" }));
    await flush();
    expect(latencyLog()).toHaveLength(1);
    expect(latencyLog()[0].marks.transcript).toBeUndefined();
  });
});

describe("no foreground speech (plan 2026-10-07 R10)", () => {
  it("does not upload a recording without foreground speech; retry uploads it", async () => {
    resetLatencyForTest();
    // 合法的 16 kHz WAV:重试时走 Task 2.4 的快速路径,不需要解码(jsdom 没有 OfflineAudioContext)
    const result = { blob: new Blob([encodeWavPcm16(new Float32Array(1600), 16000)], { type: "audio/wav" }), mimeType: "audio/wav", durationMs: 100, stoppedBy: "user" as const, noSpeech: true };
    // R30:result 永不完成,确保走 stop() 而不是自动停止
    const session = { startedAt: 0, result: new Promise<never>(() => {}), stop: vi.fn(async () => result), cancel: vi.fn() };
    const mock = createFetchMock({ "POST /api/ai/audio/transcriptions": () => json({ text: "hello" }) });
    const onDraft = vi.fn();
    const onTranscribed = vi.fn();
    const { result: hook } = renderHook(() => useVoiceTurn({
      api: new ApiClient({ getToken: () => "t", fetchImpl: mock.fetch }), newKey: () => "k1", onDraft, onTranscribed,
      starter: async () => session, urls: { create: () => "blob:1", revoke: () => undefined },
    }));
    await act(async () => { await hook.current.start(); });
    await act(async () => { await hook.current.stop(); });
    expect(onDraft).toHaveBeenLastCalledWith({ kind: "failed", key: "k1", error: expect.any(String) });
    expect(mock.calls.filter((c) => c.url.pathname === "/api/ai/audio/transcriptions")).toHaveLength(0);
    expect(latencyLog().map((r) => r.status)).toEqual(["aborted"]); // 没有上传:这一轮不计时
    await act(async () => { hook.current.retry("k1"); });
    await vi.waitFor(() => expect(onTranscribed).toHaveBeenCalledWith(expect.objectContaining({ key: "k1" }), "hello"));
    expect(mock.calls.filter((c) => c.url.pathname === "/api/ai/audio/transcriptions")).toHaveLength(1);
  });

  it("uploads a recording with foreground speech as before", async () => {
    const result = { blob: new Blob([encodeWavPcm16(new Float32Array(1600), 16000)], { type: "audio/wav" }), mimeType: "audio/wav", durationMs: 100, stoppedBy: "user" as const, noSpeech: false };
    const session = { startedAt: 0, result: new Promise<never>(() => {}), stop: vi.fn(async () => result), cancel: vi.fn() };
    const mock = createFetchMock({ "POST /api/ai/audio/transcriptions": () => json({ text: "hello" }) });
    const onTranscribed = vi.fn();
    const { result: hook } = renderHook(() => useVoiceTurn({
      api: new ApiClient({ getToken: () => "t", fetchImpl: mock.fetch }), newKey: () => "k1", onDraft: vi.fn(), onTranscribed,
      starter: async () => session, urls: { create: () => "blob:1", revoke: () => undefined },
    }));
    await act(async () => { await hook.current.start(); });
    await act(async () => { await hook.current.stop(); });
    await vi.waitFor(() => expect(onTranscribed).toHaveBeenCalledWith(expect.objectContaining({ key: "k1" }), "hello"));
  });
});

describe("stop('fill') (plan 2026-10-07 R11)", () => {
  const makeResult = () => ({ blob: new Blob([encodeWavPcm16(new Float32Array(16000).fill(0.2), 16000)], { type: "audio/wav" }), mimeType: "audio/wav", durationMs: 1000, stoppedBy: "user" as const, noSpeech: false });
  const setup = (handlers: Record<string, Handler>, over: Partial<ReturnType<typeof makeResult>> = {}) => {
    const result = { ...makeResult(), ...over };
    const session = { startedAt: 0, result: new Promise<never>(() => {}), stop: vi.fn(async () => result), cancel: vi.fn() };
    const mock = createFetchMock(handlers);
    const onDraft = vi.fn();
    const onTranscribed = vi.fn();
    const onTranscribedText = vi.fn();
    const { result: hook } = renderHook(() => useVoiceTurn({
      api: new ApiClient({ getToken: () => "t", fetchImpl: mock.fetch }), newKey: () => "k1", onDraft, onTranscribed, onTranscribedText,
      starter: async () => session, urls: { create: () => "blob:1", revoke: () => undefined },
    }));
    return { hook, session, mock, onDraft, onTranscribed, onTranscribedText };
  };

  it("fills the composer instead of sending", async () => {
    resetLatencyForTest();
    const t = setup({ "POST /api/ai/audio/transcriptions": () => json({ text: " I need a taxi. " }) });
    await act(async () => { await t.hook.current.start(); });
    await act(async () => { await t.hook.current.stop("fill"); });
    await vi.waitFor(() => expect(t.onTranscribedText).toHaveBeenCalledWith("I need a taxi."));
    expect(t.onTranscribed).not.toHaveBeenCalled();
    expect(t.onDraft).toHaveBeenLastCalledWith({ kind: "discarded", key: "k1" });
    expect(latencyLog().at(-1)?.status).toBe("complete");
  });

  it("a typed message sent while the fill transcription is in flight keeps its own latency trace", async () => {
    resetLatencyForTest();
    let release!: (r: Response) => void;
    const t = setup({ "POST /api/ai/audio/transcriptions": () => new Promise<Response>((r) => { release = r; }) });
    await act(async () => { await t.hook.current.start(); });
    await act(async () => { await t.hook.current.stop("fill"); });
    await vi.waitFor(() => expect(t.mock.calls).toHaveLength(1));
    const textTurn = startLatencyTrace("text"); // 用户在转写进行时打字发送
    await act(async () => { release(await json({ text: "late fill" })); });
    await vi.waitFor(() => expect(t.onTranscribedText).toHaveBeenCalledWith("late fill"));
    expect(latencyLog().filter((r) => r.kind === "text")).toHaveLength(0); // 文字这一轮仍在进行
    finishLatencyTrace("aborted", textTurn);
    expect(latencyLog().find((r) => r.kind === "text")?.id).toBe(textTurn);
  });

  it("retrying a no-speech to-text draft neither aborts nor closes another turn's latency trace", async () => {
    resetLatencyForTest();
    const t = setup({ "POST /api/ai/audio/transcriptions": () => json({ text: "late fill" }) }, { noSpeech: true });
    await act(async () => { await t.hook.current.start(); });
    await act(async () => { await t.hook.current.stop("fill"); });
    await vi.waitFor(() => expect(t.onDraft).toHaveBeenLastCalledWith(expect.objectContaining({ kind: "failed", key: "k1" })));
    expect(t.mock.calls).toHaveLength(0); // 没有前景语音:第一次不上传
    const textTurn = startLatencyTrace("text"); // 用户随后打字发送,回复还在路上
    await act(async () => { t.hook.current.retry("k1"); }); // 坚持转文字
    await vi.waitFor(() => expect(t.onTranscribedText).toHaveBeenCalledWith("late fill"));
    expect(latencyLog().filter((r) => r.kind === "text")).toHaveLength(0); // 文字这一轮仍在进行
    finishLatencyTrace("complete", textTurn);
    expect(latencyLog().find((r) => r.kind === "text")).toMatchObject({ id: textTurn, status: "complete" });
  });

  it("keeps the default stop() as send", async () => {
    const t = setup({ "POST /api/ai/audio/transcriptions": () => json({ text: "hello" }) });
    await act(async () => { await t.hook.current.start(); });
    await act(async () => { await t.hook.current.stop(); });
    await vi.waitFor(() => expect(t.onTranscribed).toHaveBeenCalled());
    expect(t.onTranscribedText).not.toHaveBeenCalled();
  });

  it("a failed fill says it was converting to text, for errors and for no speech", async () => {
    let calls = 0;
    const t = setup({ "POST /api/ai/audio/transcriptions": () => (++calls === 1 ? json({ detail: "x" }, 500) : json({ text: " " })) });
    await act(async () => { await t.hook.current.start(); });
    await act(async () => { await t.hook.current.stop("fill"); });
    await vi.waitFor(() => expect(t.onDraft).toHaveBeenCalledWith(expect.objectContaining({ kind: "failed" })));
    expect(t.onDraft.mock.lastCall![0].error).toMatch(/convert.*text|转文字/i);
    await act(async () => { t.hook.current.retry("k1"); });
    await vi.waitFor(() => expect(calls).toBe(2));
    await vi.waitFor(() => expect(t.onDraft.mock.lastCall![0]).toMatchObject({ kind: "failed" }));
    expect(t.onDraft.mock.lastCall![0].error).toMatch(/convert.*text|转文字/i);
  });

  it("a failed send keeps the plain error text", async () => {
    const t = setup({ "POST /api/ai/audio/transcriptions": () => json({ detail: "x" }, 500) });
    await act(async () => { await t.hook.current.start(); });
    await act(async () => { await t.hook.current.stop(); });
    await vi.waitFor(() => expect(t.onDraft).toHaveBeenCalledWith(expect.objectContaining({ kind: "failed" })));
    expect(t.onDraft.mock.lastCall![0].error).not.toMatch(/convert.*text|转文字/i);
  });

  it("retry after a failed transcription still fills", async () => {
    let calls = 0;
    const t = setup({ "POST /api/ai/audio/transcriptions": () => (++calls === 1 ? json({ detail: "x" }, 500) : json({ text: "again" })) });
    await act(async () => { await t.hook.current.start(); });
    await act(async () => { await t.hook.current.stop("fill"); });
    await vi.waitFor(() => expect(t.onDraft).toHaveBeenCalledWith(expect.objectContaining({ kind: "failed", key: "k1" })));
    await act(async () => { t.hook.current.retry("k1"); });
    await vi.waitFor(() => expect(t.onTranscribedText).toHaveBeenCalledWith("again"));
    expect(t.onTranscribed).not.toHaveBeenCalled();
  });

  it("stop('discard') releases the mic and uploads nothing", async () => {
    const t = setup({ "POST /api/ai/audio/transcriptions": () => json({ text: "no" }) });
    await act(async () => { await t.hook.current.start(); });
    await act(async () => { await t.hook.current.stop("discard"); });
    expect(t.session.cancel).toHaveBeenCalled();
    expect(t.mock.calls.length).toBe(0);
    expect(t.onTranscribed).not.toHaveBeenCalled();
    expect(t.onTranscribedText).not.toHaveBeenCalled();
    expect(t.hook.current.state).toBe("idle");
  });
});
