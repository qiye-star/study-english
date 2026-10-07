import { beforeEach, describe, expect, it, vi } from "vitest";
import { ApiClient } from "~/api/client";
import { claimAudio, releaseAudio } from "~/features/chat/audio-focus";
import { createFetchMock, json } from "~/test/fetch-mock";
import { FakeAudioContext, FakeWorkletNode, asContext, fakeStream } from "~/test/fake-audio";
import type { VadCallbacks, VadHandle } from "~/audio/vad";
import { HANGUP_CLOSE_WAIT_MS, RESUME_TIMEOUT_MS, RealtimeCall, type RealtimeCallOptions, type RealtimeEnv } from "./realtime-call";

// ownsContext 必须由调用方明确选择(漏传会关掉页面共享的上下文);可选时这一行在 tsc 下报错
const ownsContextIsRequired: {} extends Pick<RealtimeCallOptions, "ownsContext"> ? false : true = true;
void ownsContextIsRequired;
import type { CallModel } from "./call-machine";

vi.mock("~/features/chat/audio-focus", async (importOriginal) => {
  const real = await importOriginal<typeof import("~/features/chat/audio-focus")>();
  return { claimAudio: vi.fn(real.claimAudio), releaseAudio: vi.fn(real.releaseAudio) };
});

class FakeWebSocket {
  static instances: FakeWebSocket[] = [];
  static OPEN = 1;
  readyState = 0;
  binaryType = "blob";
  sent: Array<string | ArrayBuffer> = [];
  onopen: null | (() => void) = null;
  onmessage: null | ((e: { data: string | ArrayBuffer }) => void) = null;
  onclose: null | ((e: { code: number }) => void) = null;
  onerror: null | (() => void) = null;
  close = vi.fn((code?: number) => { this.readyState = 3; void code; });
  constructor(public url: string) { FakeWebSocket.instances.push(this); }
  send(data: string | ArrayBuffer) { this.sent.push(data); }
  open() { this.readyState = 1; this.onopen?.(); }
  server(event: object) { this.onmessage?.({ data: JSON.stringify(event) }); }
  serverClose(code: number) { this.readyState = 3; this.onclose?.({ code }); }
  texts() { return this.sent.filter((s): s is string => typeof s === "string").map((s) => JSON.parse(s)); }
  binaries() { return this.sent.filter((s) => typeof s !== "string"); }
}

function audioFrame(turnId: number, samples = 2400): ArrayBuffer {
  const frame = new ArrayBuffer(4 + samples * 2);
  new DataView(frame).setUint32(0, turnId);
  new Int16Array(frame, 4).fill(8000);
  return frame;
}

function setup(over: {
  ticket?: () => Response | Promise<Response>;
  gum?: () => Promise<MediaStream>;
  vadFails?: boolean;
  vadLoading?: Promise<void>;
  ownsContext?: boolean;
  now?: () => number;
  voice?: string;
} = {}) {
  FakeWebSocket.instances = [];
  const ctx = new FakeAudioContext(16000);
  const node = new FakeWorkletNode();
  const stream = fakeStream();
  let vadCallbacks!: VadCallbacks;
  const vad: VadHandle & { destroy: ReturnType<typeof vi.fn>; setSensitivity: ReturnType<typeof vi.fn>; start: ReturnType<typeof vi.fn>; pause: ReturnType<typeof vi.fn> } = {
    start: vi.fn(), pause: vi.fn(), setSensitivity: vi.fn(), destroy: vi.fn(async () => undefined),
  };
  const gum = vi.fn(over.gum ?? (async () => stream));
  const env: RealtimeEnv = {
    WebSocket: FakeWebSocket as unknown as RealtimeEnv["WebSocket"],
    capture: {
      isSecureContext: true, getUserMedia: gum, supportedConstraints: () => ({}),
      createAudioContext: () => asContext(ctx), createWorkletNode: () => node as unknown as AudioWorkletNode, workletUrl: "/w.js",
    },
    createVad: vi.fn(async (_s: MediaStream, cb: VadCallbacks) => {
      if (over.vadLoading) await over.vadLoading;
      if (over.vadFails) throw new Error("no wasm");
      vadCallbacks = cb;
      return vad;
    }),
    location: { protocol: "https:", host: "app.test" },
    ...(over.now ? { now: over.now } : {}),
  };
  const mock = createFetchMock({ "POST /api/realtime/ticket": over.ticket ?? (() => json({ ticket: "tk", expires_in: 60 })) });
  const changes: CallModel[] = [];
  const onUserMessage = vi.fn();
  const call = new RealtimeCall({
    api: new ApiClient({ getToken: () => "t", fetchImpl: mock.fetch }), conversationId: "c1", context: asContext(ctx),
    ownsContext: over.ownsContext ?? true,
    start: { systemPrompt: "Be kind.", model: "m", temperature: 0.7, voice: over.voice ?? "voice_1", saveRecordings: true },
    sampleRateOut: 24000, env, onChange: (m) => changes.push(m), onUserMessage,
  });
  const ws = () => FakeWebSocket.instances[0];
  const speech = (n = 1) => { for (let i = 0; i < n; i++) node.emit(new Float32Array(1600).fill(0.2)); };
  return { call, ctx, node, stream, vad, env, gum, mock, ws, speech, changes, onUserMessage, vadCb: () => vadCallbacks };
}

const expectReleasedOnce = (s: ReturnType<typeof setup>) => {
  expect(s.stream.track.stop).toHaveBeenCalledTimes(1);
  expect(s.ctx.close).toHaveBeenCalledTimes(1);
  expect(s.vad.destroy).toHaveBeenCalledTimes(1);
  // 播放器的输出节点已断开,音频焦点已归还
  expect(s.ctx.gain.disconnect).toHaveBeenCalled();
  const focus = vi.mocked(claimAudio).mock.calls[0]?.[0];
  expect(focus).toBeTypeOf("function");
  expect(vi.mocked(releaseAudio)).toHaveBeenCalledWith(focus);
  for (const w of FakeWebSocket.instances) expect(w.close.mock.calls.length).toBeLessThanOrEqual(1);
};

beforeEach(() => {
  vi.restoreAllMocks();
  vi.mocked(claimAudio).mockClear();
  vi.mocked(releaseAudio).mockClear();
});

describe("RealtimeCall", () => {
  it("connects with a ticket and sends start on open", async () => {
    const s = setup();
    await s.call.start();
    expect(s.ws().url).toBe("wss://app.test/api/realtime?ticket=tk");
    expect(s.ws().binaryType).toBe("arraybuffer");
    s.ws().open();
    expect(s.ws().texts()[0]).toMatchObject({ type: "start", system_prompt: "Be kind.", voice: "voice_1", save_recordings: true });
  });

  describe("ticket freshness (the ticket is single-use and expires after expires_in seconds)", () => {
    it("re-requests the ticket when the microphone prompt and VAD download took too long", async () => {
      let t = 1_000;
      let loaded!: () => void;
      let n = 0;
      const s = setup({
        now: () => t,
        vadLoading: new Promise<void>((r) => { loaded = r; }),
        ticket: () => json({ ticket: `tk${++n}`, expires_in: 60 }),
      });
      const starting = s.call.start();
      await vi.waitFor(() => expect(s.env.createVad).toHaveBeenCalled());
      t += 51_000; // 离过期不足 10 s
      loaded();
      await starting;
      expect(s.mock.calls.filter((c) => c.url.pathname === "/api/realtime/ticket")).toHaveLength(2);
      expect(s.ws().url).toBe("wss://app.test/api/realtime?ticket=tk2");
    });

    it("uses the first ticket while it is still fresh", async () => {
      let t = 1_000;
      let loaded!: () => void;
      const s = setup({ now: () => t, vadLoading: new Promise<void>((r) => { loaded = r; }) });
      const starting = s.call.start();
      await vi.waitFor(() => expect(s.env.createVad).toHaveBeenCalled());
      t += 49_000;
      loaded();
      await starting;
      expect(s.mock.calls.filter((c) => c.url.pathname === "/api/realtime/ticket")).toHaveLength(1);
      expect(s.ws().url).toBe("wss://app.test/api/realtime?ticket=tk");
    });

    it("a refused refresh ends the call and releases the microphone", async () => {
      let t = 1_000;
      let n = 0;
      let loaded!: () => void;
      const s = setup({
        now: () => t,
        vadLoading: new Promise<void>((r) => { loaded = r; }),
        ticket: () => (++n === 1 ? json({ ticket: "tk", expires_in: 60 }) : json({ error: "Realtime is not enabled" }, 503)),
      });
      const starting = s.call.start();
      await vi.waitFor(() => expect(s.env.createVad).toHaveBeenCalled());
      t += 120_000;
      loaded();
      await starting;
      expect(FakeWebSocket.instances).toHaveLength(0);
      expect(s.stream.track.stop).toHaveBeenCalledTimes(1);
      expect(s.vad.destroy).toHaveBeenCalledTimes(1);
      expect(s.changes.at(-1)!.error).toBe("web.realtime.errors.disabled");
    });
  });

  it("gives the VAD the call's audio context and starts it", async () => {
    const s = setup();
    await s.call.start();
    expect(s.env.createVad).toHaveBeenCalledWith(s.stream, expect.anything(), undefined, asContext(s.ctx));
    expect(s.vad.start).toHaveBeenCalledTimes(1);
  });

  it("streams speech with a pre-roll and ends the utterance", async () => {
    const s = setup();
    await s.call.start();
    s.ws().open();
    s.ws().server({ type: "ready", asr: "buffered" });
    s.speech(3); // 说话前的 300 ms(3 帧 × 100 ms)作为预录
    expect(s.ws().binaries()).toHaveLength(0);
    s.vadCb().onSpeechStart();
    expect(s.ws().binaries()).toHaveLength(3);
    s.speech(2);
    expect(s.ws().binaries()).toHaveLength(5);
    s.vadCb().onSpeechEnd(500);
    expect(s.ws().texts().at(-1)).toEqual({ type: "utterance_end" });
    s.speech(1);
    expect(s.ws().binaries()).toHaveLength(5); // 不说话时不上传
  });

  it("keeps only the last 300 ms as pre-roll and uploads 16-bit PCM", async () => {
    const s = setup();
    await s.call.start();
    s.ws().open();
    s.speech(6);
    s.vadCb().onSpeechStart();
    const sent = s.ws().binaries() as ArrayBuffer[];
    expect(sent).toHaveLength(3);
    expect(sent[0].byteLength).toBe(1600 * 2);
    expect(new Int16Array(sent[0])[0]).toBe(Math.round(0.2 * 0x7fff));
  });

  it("plays downlink audio, raises VAD thresholds while the bot speaks and reports user messages", async () => {
    const s = setup();
    await s.call.start();
    s.ws().open();
    s.ws().server({ type: "transcript_final", text: "hello", message_id: "m1" });
    expect(s.onUserMessage).toHaveBeenCalledWith("m1", "hello");
    s.ws().server({ type: "state", state: "speaking" });
    expect(s.vad.setSensitivity).toHaveBeenLastCalledWith("bot-speaking");
    s.ws().onmessage?.({ data: audioFrame(1) });
    expect(s.ctx.started).toHaveLength(1);
    expect(s.call.level()).toBeGreaterThan(0);
    // 服务端已发完,但本地还在播放:继续使用 bot-speaking 预设,播完才恢复
    s.ws().server({ type: "state", state: "listening" });
    expect(s.vad.setSensitivity).toHaveBeenLastCalledWith("bot-speaking");
    const source = s.ctx.createBufferSource.mock.results[0].value;
    source.onended?.();
    expect(s.vad.setSensitivity).toHaveBeenLastCalledWith("normal");
  });

  it("barge-in: speaking over the bot stops playback and sends interrupt", async () => {
    const s = setup();
    await s.call.start();
    s.ws().open();
    s.ws().server({ type: "state", state: "speaking" });
    s.ws().onmessage?.({ data: audioFrame(1) });
    const source = s.ctx.createBufferSource.mock.results[0].value;
    s.vadCb().onSpeechStart();
    expect(source.stop).toHaveBeenCalled();
    expect(s.ws().texts()).toContainEqual({ type: "interrupt" });
    expect(s.changes.at(-1)!.phase).toBe("listening");
    expect(s.vad.setSensitivity).toHaveBeenLastCalledWith("normal");
    // 被打断那一轮的迟到音频不再播放;下一轮照常播放
    s.ws().onmessage?.({ data: audioFrame(1) });
    expect(s.ctx.started).toHaveLength(1);
    s.ws().onmessage?.({ data: audioFrame(2) });
    expect(s.ctx.started).toHaveLength(2);
  });

  it("interrupt during thinking: the server is told, the previous finished reply keeps its caption unmarked", async () => {
    const s = setup();
    await s.call.start();
    s.ws().open();
    s.ws().server({ type: "reply_delta", turn_id: 1, text: "Sure." });
    s.ws().server({ type: "reply_done", turn_id: 1, message_id: "m2", interrupted: false });
    s.ws().server({ type: "transcript_final", text: "and also", message_id: "m3" });
    s.ws().server({ type: "state", state: "thinking" });
    s.vadCb().onSpeechStart();
    expect(s.ws().texts()).toContainEqual({ type: "interrupt" });
    expect(s.changes.at(-1)!.captions.find((c) => c.turnId === 1)!.interrupted).toBe(false);
  });

  it("does not interrupt when the bot is silent", async () => {
    const s = setup();
    await s.call.start();
    s.ws().open();
    s.ws().server({ type: "state", state: "listening" });
    s.vadCb().onSpeechStart();
    expect(s.ws().texts()).not.toContainEqual({ type: "interrupt" });
  });

  it("holds the audio focus for the whole call", async () => {
    const other = vi.fn();
    claimAudio(other);
    const s = setup();
    await s.call.start();
    expect(other).toHaveBeenCalledTimes(1); // 其他播放在通话开始时停下
    s.ws().open();
    s.ws().onmessage?.({ data: audioFrame(1) });
    const source = s.ctx.createBufferSource.mock.results[0].value;
    claimAudio(vi.fn()); // 通话中有别的播放者抢焦点:通话的播放先停下
    expect(source.stop).toHaveBeenCalled();
    s.call.hangup();
  });

  it("muted: nothing is uploaded", async () => {
    const s = setup();
    await s.call.start();
    s.ws().open();
    s.call.setMuted(true);
    s.vadCb().onSpeechStart();
    s.speech(2);
    expect(s.ws().binaries()).toHaveLength(0);
    expect(s.changes.at(-1)!.muted).toBe(true);
  });

  it("muting mid-utterance ends the utterance", async () => {
    const s = setup();
    await s.call.start();
    s.ws().open();
    s.vadCb().onSpeechStart();
    s.speech(1);
    s.call.setMuted(true);
    expect(s.ws().texts().at(-1)).toEqual({ type: "utterance_end" });
    s.speech(1);
    expect(s.ws().binaries()).toHaveLength(1);
  });

  it("push-to-talk mode pauses the VAD and uploads only while held", async () => {
    const s = setup();
    await s.call.start();
    s.ws().open();
    s.call.pttDown(); // 非按住说话模式:无效
    s.speech(1);
    expect(s.ws().binaries()).toHaveLength(0);
    s.call.setPushToTalk(true);
    expect(s.vad.pause).toHaveBeenCalled();
    s.vadCb().onSpeechStart(); // VAD 事件在按住说话模式下被忽略
    s.speech(1);
    expect(s.ws().binaries()).toHaveLength(0);
    s.call.pttDown(); // 按下时带上之前 300 ms 的预录(此处 2 帧)
    expect(s.ws().binaries()).toHaveLength(2);
    s.speech(2);
    s.call.pttUp();
    expect(s.ws().binaries()).toHaveLength(4);
    expect(s.ws().texts().at(-1)).toEqual({ type: "utterance_end" });
    s.call.setPushToTalk(false);
    expect(s.vad.start).toHaveBeenCalledTimes(2);
  });

  it("falls back to push-to-talk when the VAD cannot load", async () => {
    const s = setup({ vadFails: true });
    await s.call.start();
    s.ws().open();
    expect(s.changes.at(-1)!.pushToTalk).toBe(true);
    expect(s.changes.at(-1)!.notice).toBe("web.realtime.vadUnavailable");
    expect(s.changes.at(-1)!.vadUnavailable).toBe(true);
    s.call.pttDown();
    s.speech(1);
    s.call.pttUp();
    expect(s.ws().binaries()).toHaveLength(1);
    expect(s.ws().texts().at(-1)).toEqual({ type: "utterance_end" });
    s.call.setPushToTalk(false); // 没有 VAD 时不能离开按住说话模式
    expect(s.changes.at(-1)!.pushToTalk).toBe(true);
  });

  describe("the audio context must be running (R31)", () => {
    it("a context that stays suspended ends the call with an explanation and releases the microphone", async () => {
      const s = setup();
      s.ctx.resume.mockImplementation(async () => undefined); // iOS 没有解锁成功:一直是 suspended
      await s.call.start();
      expect(s.ctx.resume.mock.calls.length).toBeGreaterThanOrEqual(2); // 采集之后又试了一次
      expect(FakeWebSocket.instances).toHaveLength(0);
      expect(s.env.createVad).not.toHaveBeenCalled();
      expect(s.stream.track.stop).toHaveBeenCalledTimes(1);
      expect(s.changes.at(-1)!.phase).toBe("ended");
      expect(s.changes.at(-1)!.error).toBe("web.realtime.errors.audioSuspended");
    });

    it("a resume() that never settles times out", async () => {
      vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
      try {
        const s = setup();
        s.ctx.resume.mockImplementation(() => new Promise<void>(() => undefined));
        const starting = s.call.start();
        await vi.advanceTimersByTimeAsync(RESUME_TIMEOUT_MS + 50);
        await starting;
        expect(s.changes.at(-1)!.error).toBe("web.realtime.errors.audioSuspended");
        expect(s.stream.track.stop).toHaveBeenCalledTimes(1);
        expect(FakeWebSocket.instances).toHaveLength(0);
      } finally {
        vi.useRealTimers();
      }
    });

    it("a context that resumes on the second try carries on", async () => {
      const s = setup();
      let n = 0;
      s.ctx.resume.mockImplementation(async () => { if (++n >= 2) s.ctx.state = "running"; });
      await s.call.start();
      expect(s.ws().url).toContain("ticket=tk");
      expect(s.changes.at(-1)!.error).toBeNull();
    });
  });

  describe("every exit path releases the microphone, VAD and audio context exactly once", () => {
    it("hang up", async () => {
      const s = setup();
      await s.call.start();
      s.ws().open();
      s.call.hangup();
      expect(s.ws().texts().at(-1)).toEqual({ type: "hangup" });
      expect(s.ws().close).not.toHaveBeenCalled(); // 等服务端保存完再由它关闭(review F4 I-1)
      s.ws().serverClose(1000); // 关闭事件随后到达:不得重复释放
      s.call.hangup();
      expectReleasedOnce(s);
      expect(s.changes.at(-1)!.phase).toBe("ended");
      expect(s.changes.at(-1)!.error).toBeNull();
    });

    it("hang up while the socket is still connecting", async () => {
      const s = setup();
      await s.call.start();
      s.call.hangup();
      expect(s.ws().sent).toHaveLength(0);
      expect(s.ws().close).toHaveBeenCalledWith(1000);
      expectReleasedOnce(s);
    });

    it("server closes with a reason", async () => {
      const s = setup();
      await s.call.start();
      s.ws().open();
      s.ws().serverClose(4008);
      expectReleasedOnce(s);
      expect(s.ws().close).not.toHaveBeenCalled();
      expect(s.changes.at(-1)!.error).toBe("web.realtime.errors.idle_timeout");
    });

    it("abnormal disconnect", async () => {
      const s = setup();
      await s.call.start();
      s.ws().onerror?.();
      s.ws().serverClose(1006);
      expectReleasedOnce(s);
      expect(s.changes.at(-1)!.error).toBe("web.realtime.errors.generic");
    });

    it("ticket refused: no microphone, no socket, context closed", async () => {
      const s = setup({ ticket: () => json({ error: "Realtime is not enabled" }, 503) });
      await s.call.start();
      expect(FakeWebSocket.instances).toHaveLength(0);
      expect(s.gum).not.toHaveBeenCalled();
      expect(s.ctx.close).toHaveBeenCalledTimes(1);
      expect(s.stream.track.stop).not.toHaveBeenCalled();
      expect(s.changes.at(-1)!.error).toBe("web.realtime.errors.disabled");
    });

    it("a voice the server would refuse fails before the ticket and the microphone", async () => {
      const s = setup({ voice: "not valid" });
      await s.call.start();
      expect(s.mock.calls).toHaveLength(0);
      expect(s.gum).not.toHaveBeenCalled();
      expect(s.ctx.close).toHaveBeenCalledTimes(1);
      expect(s.changes.at(-1)!.error).toBe("web.realtime.errors.invalidVoice");
    });

    it("network failure on the ticket request", async () => {
      const s = setup({ ticket: () => { throw new TypeError("offline"); } });
      await s.call.start();
      expect(s.ctx.close).toHaveBeenCalledTimes(1);
      expect(s.changes.at(-1)!.error).toBe("web.realtime.errors.generic");
    });

    it("microphone denied", async () => {
      const s = setup({ gum: async () => { throw new DOMException("no", "NotAllowedError"); } });
      await s.call.start();
      expect(FakeWebSocket.instances).toHaveLength(0);
      expect(s.ctx.close).toHaveBeenCalledTimes(1);
      expect(s.vad.destroy).not.toHaveBeenCalled();
      expect(s.ctx.gain.disconnect).toHaveBeenCalled();
      expect(s.changes.at(-1)!.phase).toBe("ended");
      expect(s.changes.at(-1)!.error).toBe("web.recorder.permission_denied");
    });

    it("microphone track ends", async () => {
      const s = setup();
      await s.call.start();
      s.ws().open();
      s.stream.track.dispatchEvent(new Event("ended"));
      expectReleasedOnce(s);
      expect(s.ws().texts().at(-1)).toEqual({ type: "hangup" });
      expect(s.changes.at(-1)!.error).toBe("web.realtime.errors.micLost");
    });

    it("VAD failed to load, then hang up", async () => {
      const s = setup({ vadFails: true });
      await s.call.start();
      s.ws().open();
      s.call.hangup();
      expect(s.stream.track.stop).toHaveBeenCalledTimes(1);
      expect(s.ctx.close).toHaveBeenCalledTimes(1);
      expect(s.vad.destroy).not.toHaveBeenCalled();
    });

    it("ended by the page (background) before the socket opened", async () => {
      const s = setup();
      const starting = s.call.start();
      s.call.end("web.realtime.endedInBackground");
      await starting;
      expect(s.ctx.close).toHaveBeenCalledTimes(1);
      expect(s.stream.track.stop.mock.calls.length).toBeLessThanOrEqual(1);
      expect(FakeWebSocket.instances.every((w) => w.close.mock.calls.length <= 1)).toBe(true);
      expect(s.changes.at(-1)!.error).toBe("web.realtime.endedInBackground");
      expect(s.mock.calls[0].signal?.aborted).toBe(true); // 进行中的票据请求被中止
    });

    it("ended while the microphone permission prompt is open", async () => {
      let grant!: (s: MediaStream) => void;
      const stream = fakeStream();
      const s = setup({ gum: () => new Promise<MediaStream>((r) => { grant = r; }) });
      const starting = s.call.start();
      await vi.waitFor(() => expect(s.gum).toHaveBeenCalled());
      s.call.end("web.realtime.endedInBackground");
      grant(stream);
      await starting;
      expect(stream.track.stop).toHaveBeenCalledTimes(1);
      expect(s.ctx.close).toHaveBeenCalledTimes(1);
      expect(FakeWebSocket.instances).toHaveLength(0);
    });

    it("ended while the VAD is loading", async () => {
      let loaded!: () => void;
      const s = setup({ vadLoading: new Promise<void>((r) => { loaded = r; }) });
      const starting = s.call.start();
      await vi.waitFor(() => expect(s.env.createVad).toHaveBeenCalled());
      s.call.end("web.realtime.endedInBackground");
      loaded();
      await starting;
      expect(s.stream.track.stop).toHaveBeenCalledTimes(1);
      expect(s.vad.destroy).toHaveBeenCalledTimes(1);
      expect(s.vad.start).not.toHaveBeenCalled();
      expect(s.ctx.close).toHaveBeenCalledTimes(1);
      expect(FakeWebSocket.instances).toHaveLength(0);
    });

    it("never closes a shared page context it does not own", async () => {
      const s = setup({ ownsContext: false });
      await s.call.start();
      s.ws().open();
      s.call.hangup();
      expect(s.ctx.close).not.toHaveBeenCalled();
      expect(s.stream.track.stop).toHaveBeenCalledTimes(1);
      expect(s.vad.destroy).toHaveBeenCalledTimes(1);
      expect(s.ctx.gain.disconnect).toHaveBeenCalled();
    });
  });
});

describe("after a hang-up the socket stays open until the server closes it (review F4 I-1)", () => {
  const settled = async (p: Promise<void>) => {
    let done = false;
    void p.then(() => { done = true; });
    await Promise.resolve();
    await Promise.resolve();
    return done;
  };

  it("releases the microphone, VAD and player at once, keeps the socket for the server's close and still reports late user messages", async () => {
    const s = setup();
    await s.call.start();
    s.ws().open();
    const ending = s.call.ending();
    s.call.hangup();
    expect(s.ws().texts().at(-1)).toEqual({ type: "hangup" });
    expectReleasedOnce(s);
    expect(s.ws().close).not.toHaveBeenCalled();
    expect(ending.opened).toBe(true);
    expect(await settled(ending.closed)).toBe(false);
    // 服务端在关闭前还保存了一句(它的语法检查要做)
    s.ws().server({ type: "transcript_final", text: "late words", message_id: "m9" });
    expect(s.onUserMessage).toHaveBeenLastCalledWith("m9", "late words");
    const phases = s.changes.length;
    s.ws().server({ type: "reply_delta", turn_id: 3, text: "ignored" });
    expect(s.changes).toHaveLength(phases); // 结束后的界面不再变化
    s.ws().serverClose(1000);
    expect(await settled(ending.closed)).toBe(true);
    expect(s.ws().close).not.toHaveBeenCalled();
    expect(s.changes.at(-1)!.error).toBeNull();
  });

  it("closes the socket itself when the server has not closed it within the bound", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    try {
      const s = setup();
      await s.call.start();
      s.ws().open();
      s.call.hangup();
      const ending = s.call.ending();
      await vi.advanceTimersByTimeAsync(HANGUP_CLOSE_WAIT_MS - 10);
      expect(s.ws().close).not.toHaveBeenCalled();
      expect(await settled(ending.closed)).toBe(false);
      await vi.advanceTimersByTimeAsync(20);
      expect(s.ws().close).toHaveBeenCalledWith(1000);
      expect(await settled(ending.closed)).toBe(true);
      expect(HANGUP_CLOSE_WAIT_MS).toBeLessThanOrEqual(3000);
    } finally {
      vi.useRealTimers();
    }
  });

  it("drop() stops waiting: the socket is closed now and late events are ignored", async () => {
    const s = setup();
    await s.call.start();
    s.ws().open();
    s.call.hangup();
    const ending = s.call.ending();
    ending.drop();
    expect(s.ws().close).toHaveBeenCalledWith(1000);
    expect(await settled(ending.closed)).toBe(true);
    s.ws().server({ type: "transcript_final", text: "late", message_id: "m9" });
    expect(s.onUserMessage).not.toHaveBeenCalled();
    ending.drop();
    expect(s.ws().close).toHaveBeenCalledTimes(1);
  });

  it("a call ended by the page (background) also waits for the server's close", async () => {
    const s = setup();
    await s.call.start();
    s.ws().open();
    s.call.end("web.realtime.endedInBackground");
    expect(s.stream.track.stop).toHaveBeenCalledTimes(1);
    expect(s.ws().close).not.toHaveBeenCalled();
    s.ws().serverClose(1000);
    expect(await settled(s.call.ending().closed)).toBe(true);
    expect(s.changes.at(-1)!.error).toBe("web.realtime.endedInBackground");
  });

  it("is settled at once when the socket never opened, the server closed it, or there was none", async () => {
    const connecting = setup();
    await connecting.call.start();
    connecting.call.hangup();
    expect(connecting.ws().close).toHaveBeenCalledWith(1000);
    expect(connecting.call.ending().opened).toBe(false);
    expect(await settled(connecting.call.ending().closed)).toBe(true);

    const server = setup();
    await server.call.start();
    server.ws().open();
    server.ws().serverClose(4008);
    expect(server.call.ending().opened).toBe(true);
    expect(await settled(server.call.ending().closed)).toBe(true);

    const refused = setup({ ticket: () => json({ error: "Realtime is not enabled" }, 503) });
    await refused.call.start();
    expect(refused.call.ending().opened).toBe(false);
    expect(await settled(refused.call.ending().closed)).toBe(true);
  });
});

describe("RealtimeCall user messages (Task 4.11: grammar context)", () => {
  it("passes the previous assistant reply of the call as context, and none for the first turn", async () => {
    const s = setup();
    await s.call.start();
    s.ws().open();
    s.ws().server({ type: "transcript_final", text: "hello", message_id: "m1" });
    expect(s.onUserMessage).toHaveBeenLastCalledWith("m1", "hello");
    s.ws().server({ type: "reply_delta", turn_id: 1, text: "Hi! How " });
    s.ws().server({ type: "reply_delta", turn_id: 1, text: "are you?" });
    s.ws().server({ type: "reply_done", turn_id: 1, message_id: "m2", interrupted: false });
    s.ws().server({ type: "transcript_final", text: "I am fine", message_id: "m3" });
    expect(s.onUserMessage).toHaveBeenLastCalledWith("m3", "I am fine", "Hi! How are you?");
    s.ws().server({ type: "transcript_final", text: "unsaved", message_id: null });
    expect(s.onUserMessage).toHaveBeenCalledTimes(2);
  });
});
