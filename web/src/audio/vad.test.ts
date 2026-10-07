import { afterEach, describe, expect, it, vi } from "vitest";
import { createVad, loadSileroSource, VAD_ACCEPTS_EXTERNAL_CONTEXT, type ProbabilityLoader } from "./vad";
import { fakeStream } from "~/test/fake-audio";

const micVad = vi.hoisted(() => ({
  options: undefined as Record<string, any> | undefined,
  instance: {
    start: vi.fn(async () => undefined),
    pause: vi.fn(async () => undefined),
    destroy: vi.fn(async () => undefined),
    _vadNode: { disconnect: vi.fn() },
  },
}));

vi.mock("@ricky0123/vad-web", () => ({
  MicVAD: {
    new: vi.fn(async (options: Record<string, unknown>) => {
      micVad.options = options;
      return micVad.instance;
    }),
  },
}));

function fakeLoader() {
  let push: (prob: number, frame: Float32Array) => void = () => undefined;
  const source = { start: vi.fn(), pause: vi.fn(), destroy: vi.fn(async () => undefined) };
  const loader: ProbabilityLoader = vi.fn(async ({ onFrame }) => {
    push = onFrame;
    return source;
  });
  const loud = new Float32Array(512).fill(0.2); // ≈ -14 dBFS
  return { loader, source, frame: (prob: number, f = loud) => push(prob, f) };
}

describe("createVad", () => {
  it("turns probabilities and frame energy into speech start/end", async () => {
    const f = fakeLoader();
    const onSpeechStart = vi.fn();
    const onSpeechEnd = vi.fn();
    const vad = await createVad(fakeStream(), { onSpeechStart, onSpeechEnd }, f.loader);
    vad.start();
    expect(f.source.start).toHaveBeenCalled();
    for (let i = 0; i < 8; i++) f.frame(0.9);
    expect(onSpeechStart).toHaveBeenCalledTimes(1);
    for (let i = 0; i < 19; i++) f.frame(0.05);
    expect(onSpeechEnd).toHaveBeenCalledWith(256);
  });

  it("raises thresholds while the bot speaks", async () => {
    const f = fakeLoader();
    const onSpeechStart = vi.fn();
    const vad = await createVad(fakeStream(), { onSpeechStart, onSpeechEnd: vi.fn() }, f.loader);
    vad.setSensitivity("bot-speaking");
    for (let i = 0; i < 10; i++) f.frame(0.9);
    expect(onSpeechStart).not.toHaveBeenCalled();
    vad.setSensitivity("normal");
    for (let i = 0; i < 8; i++) f.frame(0.9);
    expect(onSpeechStart).toHaveBeenCalledTimes(1);
  });

  it("pause() resets the gate: the first hands-free utterance after toggling push-to-talk is not missed (review W2 M2)", async () => {
    const f = fakeLoader();
    const onSpeechStart = vi.fn();
    const onSpeechEnd = vi.fn();
    const vad = await createVad(fakeStream(), { onSpeechStart, onSpeechEnd }, f.loader);
    vad.start();
    for (let i = 0; i < 8; i++) f.frame(0.9);
    for (let i = 0; i < 5; i++) f.frame(0.05); // 160 ms 后切到按住说话(< 600 ms,门还在"说话"中)
    vad.pause();
    expect(f.source.pause).toHaveBeenCalled();
    vad.start(); // 切回免提,用户立刻开口
    for (let i = 0; i < 8; i++) f.frame(0.9);
    expect(onSpeechStart).toHaveBeenCalledTimes(2);
    expect(onSpeechEnd).not.toHaveBeenCalled();
  });

  it("destroy releases the source once and ignores later frames", async () => {
    const f = fakeLoader();
    const onSpeechStart = vi.fn();
    const vad = await createVad(fakeStream(), { onSpeechStart, onSpeechEnd: vi.fn() }, f.loader);
    await vad.destroy();
    await vad.destroy();
    expect(f.source.destroy).toHaveBeenCalledTimes(1);
    for (let i = 0; i < 10; i++) f.frame(0.9);
    expect(onSpeechStart).not.toHaveBeenCalled();
  });

  it("hands the stream and the call's AudioContext to the loader (plan R32)", async () => {
    const f = fakeLoader();
    const stream = fakeStream();
    const context = {} as AudioContext;
    await createVad(stream, { onSpeechStart: vi.fn(), onSpeechEnd: vi.fn() }, f.loader, context);
    expect(f.loader).toHaveBeenCalledWith(expect.objectContaining({ stream, context }));
  });
});

describe("loadSileroSource (plan R18/R32)", () => {
  afterEach(() => {
    micVad.options = undefined;
  });

  it("loads self-hosted assets into the given context and never stops the shared stream's tracks", async () => {
    const stream = fakeStream();
    const context = {} as AudioContext;
    const onFrame = vi.fn();
    await loadSileroSource({ stream, onFrame, context });
    const o = micVad.options!;
    expect(VAD_ACCEPTS_EXTERNAL_CONTEXT).toBe(true);
    expect(o.audioContext).toBe(context);
    expect(o.model).toBe("v5");
    expect(__VAD_ASSET_BASE__).toMatch(/^\/vad\/\d+\.\d+\.\d+-ort\d+\.\d+\.\d+\/$/); // 两个包的版本都在路径里(review W2 I3)
    expect(o.baseAssetPath).toBe(__VAD_ASSET_BASE__);
    expect(o.onnxWASMBasePath).toBe(__VAD_ASSET_BASE__);
    expect(o.startOnLoad).toBe(false);
    expect(await o.getStream()).toBe(stream);
    await o.pauseStream(stream);
    expect(await o.resumeStream(stream)).toBe(stream);
    expect(stream.track.stop).not.toHaveBeenCalled();
    const frame = new Float32Array(512);
    o.onFrameProcessed({ isSpeech: 0.7, notSpeech: 0.3 }, frame);
    expect(onFrame).toHaveBeenCalledWith(0.7, frame);
  });

  it("initialises the audio graph during load (so errors surface there) and starts paused", async () => {
    const { instance } = micVad;
    instance.start.mockClear();
    instance.pause.mockClear();
    const source = await loadSileroSource({ stream: fakeStream(), onFrame: vi.fn() });
    expect(micVad.options!.audioContext).toBeUndefined();
    expect(instance.start).toHaveBeenCalledTimes(1);
    expect(instance.pause).toHaveBeenCalledTimes(1);
    expect(instance.start.mock.invocationCallOrder[0]).toBeLessThan(instance.pause.mock.invocationCallOrder[0]);
    await source.destroy();
    expect(instance.destroy).toHaveBeenCalled();
    expect(instance._vadNode.disconnect).toHaveBeenCalled();
  });

  it("rejects when the library cannot initialise (the caller falls back to push-to-talk)", async () => {
    micVad.instance.start.mockRejectedValueOnce(new Error("addModule failed"));
    await expect(loadSileroSource({ stream: fakeStream(), onFrame: vi.fn() })).rejects.toThrow("addModule failed");
  });

  it("releases the loaded model and the library-owned AudioContext when initialisation fails (review W2 M1)", async () => {
    const release = vi.fn(async () => undefined);
    const close = vi.fn(async () => undefined);
    const node = { disconnect: vi.fn() };
    const failing = {
      ...micVad.instance,
      start: vi.fn(async () => {
        throw new Error("addModule failed");
      }),
      model: { release },
      ownsAudioContext: true,
      _audioContext: { close },
      _vadNode: null as AudioNode | null,
      _mediaStreamAudioSourceNode: node,
    };
    const { MicVAD } = await import("@ricky0123/vad-web");
    vi.mocked(MicVAD.new).mockResolvedValueOnce(failing as never);
    await expect(loadSileroSource({ stream: fakeStream(), onFrame: vi.fn() })).rejects.toThrow("addModule failed");
    expect(release).toHaveBeenCalledTimes(1);
    expect(close).toHaveBeenCalledTimes(1);
    expect(node.disconnect).toHaveBeenCalled();
  });

  it("never closes the call's own AudioContext when initialisation fails (R32)", async () => {
    const release = vi.fn(async () => undefined);
    const close = vi.fn(async () => undefined);
    const vadNode = { disconnect: vi.fn() };
    const failing = {
      ...micVad.instance,
      pause: vi.fn(async () => {
        throw new Error("pause failed");
      }),
      model: { release },
      ownsAudioContext: false,
      _audioContext: { close },
      _vadNode: vadNode,
    };
    const { MicVAD } = await import("@ricky0123/vad-web");
    vi.mocked(MicVAD.new).mockResolvedValueOnce(failing as never);
    const context = { close } as unknown as AudioContext;
    await expect(loadSileroSource({ stream: fakeStream(), onFrame: vi.fn(), context })).rejects.toThrow("pause failed");
    expect(release).toHaveBeenCalledTimes(1);
    expect(vadNode.disconnect).toHaveBeenCalled();
    expect(close).not.toHaveBeenCalled();
  });

  it("still rejects with the original error when the cleanup itself fails", async () => {
    const failing = {
      ...micVad.instance,
      start: vi.fn(async () => {
        throw new Error("model fetch failed");
      }),
      model: {
        release: vi.fn(async () => {
          throw new Error("release failed");
        }),
      },
    };
    const { MicVAD } = await import("@ricky0123/vad-web");
    vi.mocked(MicVAD.new).mockResolvedValueOnce(failing as never);
    await expect(loadSileroSource({ stream: fakeStream(), onFrame: vi.fn() })).rejects.toThrow("model fetch failed");
  });
});
