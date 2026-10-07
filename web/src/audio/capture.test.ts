import { beforeEach, describe, expect, it, vi } from "vitest";
import { RecorderError } from "./recorder";
import {
  captureConstraints, decideCapture, getPageAudioContext, installAudioUnlock, resetPageAudioContextForTests,
  ADD_MODULE_TIMEOUT_MS, NO_FRAMES_TIMEOUT_MS, startPcmCapture, unlockAudioContext, type CaptureEnv,
} from "./capture";
import { FakeAudioContext, FakeWorkletNode, asContext, fakeStream } from "~/test/fake-audio";

function env(over: Partial<CaptureEnv> = {}, ctx = new FakeAudioContext()) {
  const stream = fakeStream();
  const node = new FakeWorkletNode();
  const e: CaptureEnv = {
    isSecureContext: true,
    getUserMedia: vi.fn(async () => stream),
    supportedConstraints: () => ({ echoCancellation: true }),
    createAudioContext: () => asContext(ctx),
    createWorkletNode: vi.fn(() => node as unknown as AudioWorkletNode),
    workletUrl: "/assets/pcm-capture.worklet.js",
    ...over,
  };
  return { e, ctx, stream, node };
}

describe("captureConstraints", () => {
  it("adds voiceIsolation only when supported", () => {
    const base = { echoCancellation: true, noiseSuppression: true, autoGainControl: true, channelCount: 1 };
    expect(captureConstraints({})).toEqual({ audio: base });
    expect(captureConstraints({ voiceIsolation: true })).toEqual({ audio: { ...base, voiceIsolation: true } });
  });
});

describe("startPcmCapture", () => {
  it("creates and resumes the context before asking for the microphone", async () => {
    const order: string[] = [];
    const ctx = new FakeAudioContext();
    ctx.resume.mockImplementation(async () => { order.push("resume"); });
    const { e } = env({ getUserMedia: vi.fn(async () => { order.push("gum"); return fakeStream(); }) }, ctx);
    const capture = await startPcmCapture({ env: e });
    expect(order).toEqual(["resume", "gum"]);
    capture.release();
  });

  it("downsamples worklet frames to 16 kHz, collects them and releases everything once", async () => {
    const { e, ctx, stream, node } = env();
    const capture = await startPcmCapture({ env: e, collect: true });
    expect(capture.via).toBe("worklet");
    expect(ctx.worklet.addModule).toHaveBeenCalledWith("/assets/pcm-capture.worklet.js");
    const frames: number[] = [];
    capture.onFrame((f) => frames.push(f.length));
    node.emit(new Float32Array(4800).fill(0.1)); // 100 ms @ 48 kHz
    expect(frames).toHaveLength(1);
    expect(frames[0]).toBeGreaterThan(1600 - 20); // 抗混叠 FIR 约 18 个输出采样(~1 ms)的延迟
    expect(capture.collected().length).toBe(1600); // 取结果时 flush 尾部
    capture.release();
    capture.release();
    expect(stream.track.stop).toHaveBeenCalledTimes(1);
    expect(ctx.close).toHaveBeenCalledTimes(1);
    expect(node.disconnect).toHaveBeenCalled();
    node.emit(new Float32Array(4800)); // 释放后的帧被忽略
    expect(frames).toHaveLength(1);
  });

  it("falls back to a ScriptProcessor when the worklet module fails", async () => {
    const ctx = new FakeAudioContext();
    ctx.worklet.addModule.mockRejectedValueOnce(new Error("blocked"));
    const { e } = env({}, ctx);
    const capture = await startPcmCapture({ env: e, collect: true });
    expect(capture.via).toBe("script-processor");
    ctx.processor.emit(new Float32Array(4800).fill(0.2));
    expect(capture.collected().length).toBe(1600);
    capture.release();
  });

  it("falls back when audioWorklet does not exist", async () => {
    const ctx = new FakeAudioContext();
    ctx.audioWorklet = undefined;
    const capture = await startPcmCapture({ env: env({}, ctx).e });
    expect(capture.via).toBe("script-processor");
    capture.release();
  });

  it("maps permission errors and closes the context it created", async () => {
    const ctx = new FakeAudioContext();
    const { e } = env({ getUserMedia: vi.fn(async () => { throw new DOMException("no", "NotAllowedError"); }) }, ctx);
    await expect(startPcmCapture({ env: e })).rejects.toMatchObject({ code: "permission_denied" });
    expect(ctx.close).toHaveBeenCalledTimes(1);
  });

  it("refuses an insecure context without creating anything", async () => {
    const create = vi.fn();
    await expect(startPcmCapture({ env: { ...env().e, isSecureContext: false, createAudioContext: create } })).rejects.toBeInstanceOf(RecorderError);
    expect(create).not.toHaveBeenCalled();
  });

  describe("release leaves nothing alive on the shared context (review W1 I-2)", () => {
    it("worklet path: clears the port handler, stops the processor, disconnects and drops collected audio", async () => {
      const shared = new FakeAudioContext();
      const { e, node } = env();
      const capture = await startPcmCapture({ env: e, context: asContext(shared), collect: true });
      node.emit(new Float32Array(4800).fill(0.1));
      expect(capture.collected().length).toBeGreaterThan(0);
      expect(capture.collected().length).toBe(0); // 结果取走后不再持有
      node.emit(new Float32Array(4800).fill(0.1));
      const handler = node.port.onmessage;
      capture.release();
      expect(node.port.onmessage).toBeNull();
      expect(node.port.postMessage).toHaveBeenCalledWith("stop");
      expect(node.disconnect).toHaveBeenCalled();
      expect(shared.source.disconnect).toHaveBeenCalled();
      handler?.({ data: new Float32Array(4800).fill(0.1) } as MessageEvent); // 迟到的帧
      expect(capture.collected().length).toBe(0);
    });

    it("script-processor path: clears onaudioprocess and disconnects every node even if one throws", async () => {
      const shared = new FakeAudioContext();
      shared.audioWorklet = undefined;
      shared.source.disconnect.mockImplementation(() => { throw new Error("already"); });
      const capture = await startPcmCapture({ env: env().e, context: asContext(shared), collect: true });
      shared.processor.emit(new Float32Array(4800).fill(0.1));
      capture.release();
      expect(shared.processor.onaudioprocess).toBeNull();
      expect(shared.processor.disconnect).toHaveBeenCalled();
      expect(shared.gain.disconnect).toHaveBeenCalled();
      expect(capture.collected().length).toBe(0);
    });
  });

  describe("worklet watchdogs (review W1 M-4/M-5)", () => {
    function manualTimers() {
      const due: Array<{ fn: () => void; ms: number; handle: number; cleared: boolean }> = [];
      let next = 0;
      return {
        due,
        timers: {
          setTimeout: (fn: () => void, ms: number) => { const t = { fn, ms, handle: ++next, cleared: false }; due.push(t); return t.handle; },
          clearTimeout: (h: unknown) => due.forEach((t) => { if (t.handle === h) t.cleared = true; }),
        },
        /** 触发所有给定时长、尚未清除的定时器 */
        fire(ms: number) {
          due.filter((t) => t.ms === ms && !t.cleared).forEach((t) => { t.cleared = true; t.fn(); });
        },
      };
    }

    it("falls back to a ScriptProcessor when addModule stalls for 3 s", async () => {
      const ctx = new FakeAudioContext();
      ctx.state = "running";
      ctx.worklet.addModule.mockImplementation(() => new Promise<undefined>(() => {}));
      const t = manualTimers();
      const { e } = env({ timers: t.timers }, ctx);
      const pending = startPcmCapture({ env: e, context: asContext(ctx), collect: true });
      await Promise.resolve();
      expect(t.due.map((d) => d.ms)).toContain(ADD_MODULE_TIMEOUT_MS);
      expect(ADD_MODULE_TIMEOUT_MS).toBe(3000);
      t.fire(ADD_MODULE_TIMEOUT_MS);
      const capture = await pending;
      expect(capture.via).toBe("script-processor");
      expect(e.createWorkletNode).not.toHaveBeenCalled();
      capture.release();
    });

    it("clears the addModule timer once the module loads", async () => {
      const ctx = new FakeAudioContext();
      const t = manualTimers();
      const capture = await startPcmCapture({ env: env({ timers: t.timers }, ctx).e, context: asContext(ctx) });
      expect(t.due.find((d) => d.ms === ADD_MODULE_TIMEOUT_MS)?.cleared).toBe(true);
      capture.release();
    });

    it("switches to a ScriptProcessor when the running worklet delivers no frames", async () => {
      const ctx = new FakeAudioContext();
      ctx.state = "running";
      const t = manualTimers();
      const { e, node } = env({ timers: t.timers }, ctx);
      const capture = await startPcmCapture({ env: e, context: asContext(ctx), collect: true });
      expect(capture.via).toBe("worklet");
      t.fire(NO_FRAMES_TIMEOUT_MS);
      expect(capture.via).toBe("script-processor");
      expect(node.port.onmessage).toBeNull();
      expect(node.port.postMessage).toHaveBeenCalledWith("stop");
      expect(node.disconnect).toHaveBeenCalled();
      ctx.processor.emit(new Float32Array(4800).fill(0.1));
      expect(capture.collected().length).toBe(1600);
      capture.release();
      expect(ctx.processor.onaudioprocess).toBeNull();
    });

    it("keeps the worklet once frames arrive, and waits while the context is not running", async () => {
      const ctx = new FakeAudioContext();
      ctx.state = "suspended";
      ctx.resume.mockImplementation(async () => undefined); // 一直解不开锁
      const t = manualTimers();
      const { e, node } = env({ timers: t.timers }, ctx);
      const capture = await startPcmCapture({ env: e, context: asContext(ctx) });
      t.fire(NO_FRAMES_TIMEOUT_MS); // 上下文还没 running:不算 worklet 的错,重新等待
      expect(capture.via).toBe("worklet");
      ctx.state = "running";
      node.emit(new Float32Array(2048));
      t.fire(NO_FRAMES_TIMEOUT_MS);
      expect(capture.via).toBe("worklet");
      expect(ctx.createScriptProcessor).not.toHaveBeenCalled();
      capture.release();
    });

    it("cancels pending watchdogs on release", async () => {
      const ctx = new FakeAudioContext();
      const t = manualTimers();
      const capture = await startPcmCapture({ env: env({ timers: t.timers }, ctx).e, context: asContext(ctx) });
      capture.release();
      expect(t.due.every((d) => d.cleared)).toBe(true);
    });
  });

  describe("failures after the microphone was granted (review W1 I-1)", () => {
    it("stops the tracks and closes its own context when the graph setup throws", async () => {
      const ctx = new FakeAudioContext();
      ctx.audioWorklet = undefined;
      ctx.createScriptProcessor.mockImplementation(() => { throw new Error("boom"); });
      const { e, stream } = env({}, ctx);
      await expect(startPcmCapture({ env: e })).rejects.toBeInstanceOf(RecorderError);
      expect(stream.track.stop).toHaveBeenCalledTimes(1);
      expect(ctx.close).toHaveBeenCalledTimes(1);
    });

    it("stops the tracks when the context rate is unusable (below 16 kHz)", async () => {
      const ctx = new FakeAudioContext(8000);
      const { e, stream } = env({}, ctx);
      await expect(startPcmCapture({ env: e })).rejects.toMatchObject({ code: "failed" });
      expect(stream.track.stop).toHaveBeenCalledTimes(1);
      expect(ctx.close).toHaveBeenCalledTimes(1);
    });

    it("stops the tracks but never closes a borrowed context", async () => {
      const shared = new FakeAudioContext();
      shared.createMediaStreamSource.mockImplementation(() => { throw new DOMException("rate", "NotSupportedError"); });
      const { e, stream } = env({ createAudioContext: undefined });
      await expect(startPcmCapture({ env: e, context: asContext(shared) })).rejects.toMatchObject({ code: "failed" });
      expect(stream.track.stop).toHaveBeenCalledTimes(1);
      expect(shared.close).not.toHaveBeenCalled();
    });

    it("retries once on a dedicated context at the stream's rate when the source rejects a rate mismatch (Firefox)", async () => {
      const shared = new FakeAudioContext(48000);
      shared.createMediaStreamSource.mockImplementation(() => { throw new DOMException("different sample-rate", "NotSupportedError"); });
      const dedicated = new FakeAudioContext(16000);
      const create = vi.fn((_o?: AudioContextOptions) => asContext(dedicated));
      const { e, stream } = env({ createAudioContext: create });
      (stream.track as unknown as { getSettings: () => MediaTrackSettings }).getSettings = () => ({ sampleRate: 16000 });
      const capture = await startPcmCapture({ env: e, context: asContext(shared), collect: true });
      expect(create).toHaveBeenCalledWith({ sampleRate: 16000 });
      expect(capture.context).toBe(asContext(dedicated));
      expect(dedicated.resume).toHaveBeenCalled();
      capture.release();
      expect(dedicated.close).toHaveBeenCalledTimes(1);
      expect(shared.close).not.toHaveBeenCalled();
      expect(stream.track.stop).toHaveBeenCalledTimes(1);
    });

    it("gives up after the single retry and still releases everything", async () => {
      const shared = new FakeAudioContext(48000);
      const dedicated = new FakeAudioContext(16000);
      for (const c of [shared, dedicated]) c.createMediaStreamSource.mockImplementation(() => { throw new DOMException("rate", "NotSupportedError"); });
      const { e, stream } = env({ createAudioContext: () => asContext(dedicated) });
      (stream.track as unknown as { getSettings: () => MediaTrackSettings }).getSettings = () => ({ sampleRate: 16000 });
      await expect(startPcmCapture({ env: e, context: asContext(shared) })).rejects.toMatchObject({ code: "failed" });
      expect(dedicated.createMediaStreamSource).toHaveBeenCalledTimes(1);
      expect(dedicated.close).toHaveBeenCalledTimes(1);
      expect(shared.close).not.toHaveBeenCalled();
      expect(stream.track.stop).toHaveBeenCalledTimes(1);
    });
  });

  it("does not close a context it did not create and reports track end", async () => {
    const shared = new FakeAudioContext();
    const { e, stream } = env();
    const capture = await startPcmCapture({ env: e, context: asContext(shared) });
    const ended = vi.fn();
    capture.onTrackEnded(ended);
    stream.track.dispatchEvent(new Event("ended"));
    expect(ended).toHaveBeenCalledTimes(1);
    capture.release();
    expect(shared.close).not.toHaveBeenCalled();
  });
});

describe("unlockAudioContext", () => {
  it("resumes synchronously and plays one silent sample", () => {
    const ctx = new FakeAudioContext();
    unlockAudioContext(asContext(ctx));
    expect(ctx.resume).toHaveBeenCalledTimes(1);
    expect(ctx.started).toHaveLength(1);
  });
});

describe("page-level AudioContext (R31)", () => {
  beforeEach(() => resetPageAudioContextForTests());

  it("reuses one context, unlocks it on the first click and does nothing while it is running", () => {
    const ctx = new FakeAudioContext();
    const { e } = env({}, ctx);
    const create = vi.fn(e.createAudioContext!);
    const target = new EventTarget();
    installAudioUnlock(target, { ...e, createAudioContext: create });
    target.dispatchEvent(new Event("click"));
    expect(ctx.resume).toHaveBeenCalledTimes(1);
    expect(ctx.started).toHaveLength(1);
    target.dispatchEvent(new Event("touchend"));
    expect(ctx.resume).toHaveBeenCalledTimes(1);
    expect(create).toHaveBeenCalledTimes(1);
    expect(getPageAudioContext(e)).toBe(asContext(ctx));
  });

  it("unlocks again on the next tap after iOS interrupts or suspends the context (review W1 I-3)", () => {
    const ctx = new FakeAudioContext();
    const { e } = env({}, ctx);
    const target = new EventTarget();
    installAudioUnlock(target, e);
    target.dispatchEvent(new Event("click"));
    expect(decideCapture(e).mode).toBe("pcm");
    for (const state of ["interrupted", "suspended"] as AudioContextState[]) {
      ctx.state = state; // 来电 / Siri / 切到后台
      expect(decideCapture(e)).toMatchObject({ mode: "media-recorder", reason: "audio-locked" });
      target.dispatchEvent(new Event("touchend"));
      expect(decideCapture(e).mode).toBe("pcm");
    }
    expect(ctx.resume).toHaveBeenCalledTimes(3);
  });

  it("rebuilds a closed page context and unlocks the new one on the next tap", () => {
    const first = new FakeAudioContext();
    const second = new FakeAudioContext();
    const contexts = [first, second];
    const { e } = env({ createAudioContext: () => asContext(contexts.shift()!) });
    const target = new EventTarget();
    installAudioUnlock(target, e);
    target.dispatchEvent(new Event("click"));
    first.state = "closed";
    target.dispatchEvent(new Event("click"));
    expect(second.resume).toHaveBeenCalledTimes(1);
    expect(decideCapture(e)).toEqual({ mode: "pcm", context: asContext(second) });
  });

  it("keeps listening while the context stays locked", () => {
    const ctx = new FakeAudioContext();
    ctx.resume.mockImplementation(async () => undefined);
    const target = new EventTarget();
    installAudioUnlock(target, env({}, ctx).e);
    target.dispatchEvent(new Event("touchend"));
    target.dispatchEvent(new Event("click"));
    expect(ctx.resume).toHaveBeenCalledTimes(2);
  });

  it("uses PCM only when the page context is running, otherwise MediaRecorder", () => {
    const ctx = new FakeAudioContext();
    const { e } = env({}, ctx);
    expect(decideCapture(e)).toEqual({ mode: "media-recorder", reason: "audio-locked" });
    ctx.state = "running";
    expect(decideCapture(e)).toEqual({ mode: "pcm", context: asContext(ctx) });
    ctx.state = "interrupted" as AudioContextState;
    expect(decideCapture(e)).toMatchObject({ mode: "media-recorder", reason: "audio-locked" });
  });

  it("falls back as unsupported without AudioContext or secure context", () => {
    expect(decideCapture(env({ createAudioContext: undefined }).e)).toEqual({ mode: "media-recorder", reason: "unsupported" });
    expect(decideCapture(env({ isSecureContext: false }).e)).toEqual({ mode: "media-recorder", reason: "unsupported" });
  });
});
