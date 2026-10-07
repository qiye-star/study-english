import { describe, expect, it, vi } from "vitest";
import { startPcmRecording, type PcmRecordingEnv } from "./pcm-recording";
import { FakeAudioContext, FakeWorkletNode, asContext, fakeStream } from "~/test/fake-audio";

function setup() {
  const ctx = new FakeAudioContext(16000);
  const node = new FakeWorkletNode();
  const stream = fakeStream();
  let now = 0;
  const timers: Array<() => void> = [];
  const listeners: Record<string, () => void> = {};
  const env: PcmRecordingEnv = {
    isSecureContext: true,
    getUserMedia: vi.fn(async () => stream),
    supportedConstraints: () => ({}),
    createAudioContext: () => asContext(ctx),
    createWorkletNode: () => node as unknown as AudioWorkletNode,
    workletUrl: "/w.js",
    now: () => now,
    document: { visibilityState: "visible", addEventListener: (t: string, f: () => void) => (listeners[t] = f), removeEventListener: vi.fn() } as never,
    setTimeout: (fn) => timers.push(fn),
    clearTimeout: vi.fn(),
  };
  const tone = (seconds: number, amp: number) =>
    Float32Array.from({ length: seconds * 16000 }, (_, i) => amp * Math.sin((2 * Math.PI * 200 * i) / 16000));
  return { env, ctx, node, stream, tone, advance: (ms: number) => (now += ms), timers, listeners };
}

describe("startPcmRecording", () => {
  it("stops immediately with a trimmed 16 kHz WAV and releases the microphone", async () => {
    const s = setup();
    const session = await startPcmRecording({ env: s.env });
    s.node.emit(new Float32Array(16000)); // 1 s 静音
    s.node.emit(s.tone(1, 0.3)); // 1 s "语音"
    s.node.emit(new Float32Array(16000));
    s.advance(3000);
    const result = await session.stop();
    expect(result.mimeType).toBe("audio/wav");
    expect(result.noSpeech).toBe(false);
    expect(result.durationMs).toBeGreaterThan(1300);
    expect(result.durationMs).toBeLessThan(1500);
    expect(result.stoppedBy).toBe("user");
    expect(s.stream.track.stop).toHaveBeenCalledTimes(1);
    expect(s.ctx.close).toHaveBeenCalledTimes(1);
  });

  it("flags recordings without foreground speech and keeps them untrimmed", async () => {
    const s = setup();
    const session = await startPcmRecording({ env: s.env });
    s.node.emit(s.tone(2, 0.003)); // ≈ -53 dBFS
    const result = await session.stop();
    expect(result.noSpeech).toBe(true);
    expect(result.durationMs).toBe(2000);
  });

  it("auto-stops at the maximum duration", async () => {
    const s = setup();
    const session = await startPcmRecording({ env: s.env, maxDurationMs: 60_000 });
    s.node.emit(s.tone(1, 0.3));
    s.timers[0]();
    expect((await session.result).stoppedBy).toBe("max_duration");
  });

  it("stops as background when the page is hidden, and cancel releases without a result", async () => {
    const s = setup();
    const session = await startPcmRecording({ env: s.env });
    (s.env.document as { visibilityState: string }).visibilityState = "hidden";
    s.listeners.visibilitychange();
    expect((await session.result).stoppedBy).toBe("background");
    const s2 = setup();
    const other = await startPcmRecording({ env: s2.env });
    other.cancel();
    expect(s2.stream.track.stop).toHaveBeenCalledTimes(1);
  });

  it("records on a shared page-level context without closing it (R31)", async () => {
    const s = setup();
    const shared = new FakeAudioContext(16000);
    const session = await startPcmRecording({ env: s.env, context: asContext(shared) });
    s.node.emit(s.tone(1, 0.3));
    const result = await session.stop();
    expect(result.noSpeech).toBe(false);
    expect(s.stream.track.stop).toHaveBeenCalledTimes(1);
    expect(shared.close).not.toHaveBeenCalled();
    expect(s.ctx.close).not.toHaveBeenCalled();
  });

  it("stops when the microphone track ends", async () => {
    const s = setup();
    const session = await startPcmRecording({ env: s.env });
    s.node.emit(s.tone(1, 0.3));
    s.stream.track.dispatchEvent(new Event("ended"));
    expect((await session.result).stoppedBy).toBe("track_ended");
    expect(s.stream.track.stop).toHaveBeenCalledTimes(1);
  });
});
