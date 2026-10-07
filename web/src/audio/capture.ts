import workletUrl from "./pcm-capture.worklet.js?url";
import { Downsampler, TARGET_RATE, concatFloat, dbfs, frameRms } from "./pcm";
import { RecorderError, mapGetUserMediaError } from "./recorder";

export interface CaptureEnv {
  isSecureContext: boolean;
  getUserMedia?: (constraints: MediaStreamConstraints) => Promise<MediaStream>;
  supportedConstraints(): Record<string, boolean | undefined>;
  createAudioContext?: (options?: AudioContextOptions) => AudioContext;
  createWorkletNode?: (ctx: AudioContext) => AudioWorkletNode;
  workletUrl: string;
}

export interface PcmCapture {
  readonly stream: MediaStream;
  readonly context: AudioContext;
  readonly via: "worklet" | "script-processor";
  onFrame(cb: (frame16k: Float32Array, dbfs: number) => void): () => void;
  onTrackEnded(cb: () => void): () => void;
  collected(): Float32Array;
  release(): void;
}

type Ctor = typeof AudioContext;
const audioContextCtor = (): Ctor | undefined =>
  (globalThis as { AudioContext?: Ctor }).AudioContext ?? (globalThis as { webkitAudioContext?: Ctor }).webkitAudioContext;

export function browserCaptureEnv(): CaptureEnv {
  const devices = typeof navigator !== "undefined" ? navigator.mediaDevices : undefined;
  const Ctx = audioContextCtor();
  return {
    isSecureContext: typeof window !== "undefined" && window.isSecureContext,
    getUserMedia: devices?.getUserMedia ? (c) => devices.getUserMedia(c) : undefined,
    supportedConstraints: () => (devices?.getSupportedConstraints?.() ?? {}) as Record<string, boolean | undefined>,
    createAudioContext: Ctx ? (options) => new Ctx(options) : undefined,
    createWorkletNode: typeof AudioWorkletNode === "undefined" ? undefined : (ctx) => new AudioWorkletNode(ctx, "pcm-capture", { numberOfOutputs: 0 }),
    workletUrl,
  };
}

export function captureConstraints(supported: Record<string, boolean | undefined>): MediaStreamConstraints {
  const audio: MediaTrackConstraints & { voiceIsolation?: boolean } = {
    echoCancellation: true, noiseSuppression: true, autoGainControl: true, channelCount: 1,
  };
  if (supported.voiceIsolation) audio.voiceIsolation = true;
  return { audio };
}

export function pcmCaptureSupported(env: CaptureEnv = browserCaptureEnv()): boolean {
  return env.isSecureContext && !!env.getUserMedia && !!env.createAudioContext;
}

/** iOS:必须在点击的同步阶段调用;不 await。 */
export function unlockAudioContext(ctx: AudioContext): void {
  try {
    void ctx.resume?.()?.catch?.((): void => undefined);
    const buffer = ctx.createBuffer(1, 1, ctx.sampleRate);
    const source = ctx.createBufferSource();
    source.buffer = buffer;
    source.connect(ctx.destination);
    source.start(0);
  } catch {
    /* 测试环境或已关闭的上下文 */
  }
}

const toCaptureError = (err: unknown) => (err instanceof RecorderError ? err : new RecorderError("failed", String(err)));

/** 麦克风轨道的实际采样率(Firefox 要求 MediaStreamSource 与上下文同采样率);拿不到时 undefined。 */
function streamSampleRate(stream: MediaStream): number | undefined {
  try {
    const rate = stream.getAudioTracks?.()[0]?.getSettings?.().sampleRate;
    return typeof rate === "number" && rate > 0 ? rate : undefined;
  } catch {
    return undefined;
  }
}

export async function startPcmCapture(opts: { env?: CaptureEnv; context?: AudioContext; collect?: boolean } = {}): Promise<PcmCapture> {
  const env = opts.env ?? browserCaptureEnv();
  if (!env.isSecureContext) throw new RecorderError("insecure_context");
  if (!env.getUserMedia || (!opts.context && !env.createAudioContext)) throw new RecorderError("unsupported");
  let owned = !opts.context;
  let ctx = opts.context ?? env.createAudioContext!(); // 在 await 之前同步创建(iOS 手势)
  void ctx.resume?.()?.catch?.((): void => undefined);
  let stream: MediaStream;
  try {
    stream = await env.getUserMedia(captureConstraints(env.supportedConstraints()));
  } catch (err) {
    if (owned) void ctx.close?.()?.catch?.((): void => undefined);
    throw mapGetUserMediaError(err);
  }
  const tracks = stream.getTracks();
  // 麦克风已到手:此后任何失败都必须停掉轨道、关闭自己创建的上下文(review W1 I-1)
  try {
    return await buildCapture();
  } catch (err) {
    tracks.forEach((t) => {
      try { t.stop(); } catch { /* 已停止 */ }
    });
    if (owned) void ctx.close?.()?.catch?.((): void => undefined);
    throw toCaptureError(err);
  }

  function createSource(): MediaStreamAudioSourceNode {
    try {
      return ctx.createMediaStreamSource(stream);
    } catch (err) {
      // Firefox:上下文与麦克风采样率不同(如中途切到 16 kHz 蓝牙耳机)会抛 NotSupportedError。
      // 只重试一次:在麦克风的采样率上新建一个专用上下文(由本次采集拥有并关闭)。
      const rate = streamSampleRate(stream);
      if (!rate || rate === ctx.sampleRate || !env.createAudioContext) throw err;
      if (owned) void ctx.close?.()?.catch?.((): void => undefined);
      ctx = env.createAudioContext({ sampleRate: rate });
      owned = true;
      void ctx.resume?.()?.catch?.((): void => undefined);
      return ctx.createMediaStreamSource(stream);
    }
  }

  async function buildCapture(): Promise<PcmCapture> {
    const source = createSource();
    const downsampler = new Downsampler(ctx.sampleRate, TARGET_RATE);
    const frameListeners = new Set<(f: Float32Array, level: number) => void>();
    const endListeners = new Set<() => void>();
    let parts: Float32Array[] = [];
    let released = false;
    let taken = false; // 结果已取走(降采样器已 flush)

    const handle = (samples: Float32Array) => {
      if (released || taken) return;
      const frame = downsampler.process(samples);
      if (!frame.length) return;
      if (opts.collect) parts.push(frame);
      const level = dbfs(frameRms(frame));
      frameListeners.forEach((cb) => cb(frame, level));
    };

    /** 断开并解除一个采集节点的所有引用:页面级上下文从不关闭,残留的处理器/回调会连同录音一起常驻(review W1 I-2)。 */
    const detachers: Array<() => void> = [() => source.disconnect()];
    const detachAll = () => {
      for (const detach of detachers.splice(0)) {
        try { detach(); } catch { /* 已断开 */ }
      }
    };

    let via: PcmCapture["via"] = "script-processor";
    try {
      if (!(ctx.audioWorklet && env.createWorkletNode && (await attachWorklet()))) attachScriptProcessor();
    } catch (err) {
      detachAll();
      throw err;
    }

    async function attachWorklet(): Promise<boolean> {
      let worklet: AudioWorkletNode;
      try {
        await ctx.audioWorklet.addModule(env.workletUrl);
        worklet = env.createWorkletNode!(ctx);
        worklet.port.onmessage = (event: MessageEvent) => handle(event.data as Float32Array);
        source.connect(worklet);
      } catch {
        return false;
      }
      detachers.push(() => {
        worklet.port.onmessage = null;
        worklet.port.postMessage("stop"); // 让 process() 返回 false,处理器停止并可回收
      }, () => worklet.disconnect());
      via = "worklet";
      return true;
    }

    function attachScriptProcessor() {
      const processor = ctx.createScriptProcessor(4096, 1, 1);
      detachers.push(() => { processor.onaudioprocess = null; }, () => processor.disconnect());
      processor.onaudioprocess = (event) => handle(event.inputBuffer.getChannelData(0).slice());
      const mute = ctx.createGain();
      detachers.push(() => mute.disconnect());
      mute.gain.value = 0;
      source.connect(processor);
      processor.connect(mute);
      mute.connect(ctx.destination); // ScriptProcessor 需要连到输出才会工作
      via = "script-processor";
    }

    const onEnded = () => endListeners.forEach((cb) => cb());
    tracks.forEach((t) => t.addEventListener?.("ended", onEnded));

    return {
      stream,
      context: ctx,
      get via() {
        return via;
      },
      onFrame(cb) {
        frameListeners.add(cb);
        return () => frameListeners.delete(cb);
      },
      onTrackEnded(cb) {
        endListeners.add(cb);
        return () => endListeners.delete(cb);
      },
      /** 取走已收集的 16 kHz 样本(含降采样器 flush 出的尾部);录音到此结束,之后不再持有、也不再收集。 */
      collected() {
        if (!taken && opts.collect && !released) parts.push(downsampler.flush());
        taken = true;
        const result = concatFloat(parts);
        parts = [];
        return result;
      },
      release() {
        if (released) return;
        released = true;
        frameListeners.clear();
        endListeners.clear();
        parts = [];
        detachAll();
        tracks.forEach((t) => {
          t.removeEventListener?.("ended", onEnded);
          t.stop();
        });
        if (owned) void ctx.close?.()?.catch?.((): void => undefined);
      },
    };
  }
}

/* ---- R31:页面级唯一 AudioContext、首次点击解锁、按住说话时的采集路径决策 ---- */

let pageContext: AudioContext | undefined;

/** 页面级唯一的 AudioContext(懒创建;已关闭则重建)。无法创建时返回 undefined。 */
export function getPageAudioContext(env: CaptureEnv = browserCaptureEnv()): AudioContext | undefined {
  if (pageContext && pageContext.state !== "closed") return pageContext;
  pageContext = undefined;
  if (!env.createAudioContext) return undefined;
  try {
    pageContext = env.createAudioContext();
  } catch {
    pageContext = undefined;
  }
  return pageContext;
}

export function pageAudioContextRunning(): boolean {
  return pageContext?.state === "running";
}

/**
 * 在 click / touchend 的同步阶段解锁页面级 AudioContext(iOS 的 pointerdown 不算用户激活)。
 * 监听一直保留:上下文 running 时什么都不做;iOS 在来电、Siri、切后台后会把它变成 interrupted / suspended
 * (或关闭后重建出一个 suspended 的新上下文),下一次点击即重新解锁,decideCapture 随之恢复 PCM(review W1 I-3)。
 * 返回手动卸载函数。
 */
export function installAudioUnlock(target: EventTarget = document, env?: CaptureEnv): () => void {
  const events = ["click", "touchend"] as const;
  function onGesture() {
    const ctx = getPageAudioContext(env);
    if (!ctx || ctx.state === "running") return;
    unlockAudioContext(ctx);
  }
  events.forEach((name) => target.addEventListener(name, onGesture, true));
  return () => events.forEach((name) => target.removeEventListener(name, onGesture, true));
}

export type CaptureDecision =
  | { mode: "pcm"; context: AudioContext }
  | { mode: "media-recorder"; reason: "unsupported" | "audio-locked" };

/** 按住说话开始时调用(同步):上下文不是 running 时退到 MediaRecorder,不得录出静音。 */
export function decideCapture(env: CaptureEnv = browserCaptureEnv()): CaptureDecision {
  if (!pcmCaptureSupported(env)) return { mode: "media-recorder", reason: "unsupported" };
  const ctx = getPageAudioContext(env);
  if (!ctx) return { mode: "media-recorder", reason: "unsupported" };
  if (ctx.state !== "running") return { mode: "media-recorder", reason: "audio-locked" };
  return { mode: "pcm", context: ctx };
}

/** 仅测试用。 */
export function resetPageAudioContextForTests(): void {
  pageContext = undefined;
}
