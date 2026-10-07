import workletUrl from "./pcm-capture.worklet.js?url";
import { Downsampler, TARGET_RATE, concatFloat, dbfs, frameRms } from "./pcm";
import { RecorderError, mapGetUserMediaError } from "./recorder";

export interface CaptureEnv {
  isSecureContext: boolean;
  getUserMedia?: (constraints: MediaStreamConstraints) => Promise<MediaStream>;
  supportedConstraints(): Record<string, boolean | undefined>;
  createAudioContext?: () => AudioContext;
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
    createAudioContext: Ctx ? () => new Ctx() : undefined,
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

export async function startPcmCapture(opts: { env?: CaptureEnv; context?: AudioContext; collect?: boolean } = {}): Promise<PcmCapture> {
  const env = opts.env ?? browserCaptureEnv();
  if (!env.isSecureContext) throw new RecorderError("insecure_context");
  if (!env.getUserMedia || (!opts.context && !env.createAudioContext)) throw new RecorderError("unsupported");
  const owned = !opts.context;
  const ctx = opts.context ?? env.createAudioContext!(); // 在 await 之前同步创建(iOS 手势)
  void ctx.resume?.()?.catch?.((): void => undefined);
  let stream: MediaStream;
  try {
    stream = await env.getUserMedia(captureConstraints(env.supportedConstraints()));
  } catch (err) {
    if (owned) void ctx.close?.()?.catch?.((): void => undefined);
    throw mapGetUserMediaError(err);
  }
  const tracks = stream.getTracks();
  const source = ctx.createMediaStreamSource(stream);
  const downsampler = new Downsampler(ctx.sampleRate, TARGET_RATE);
  const frameListeners = new Set<(f: Float32Array, level: number) => void>();
  const endListeners = new Set<() => void>();
  const parts: Float32Array[] = [];
  let released = false;

  const handle = (samples: Float32Array) => {
    if (released) return;
    const frame = downsampler.process(samples);
    if (!frame.length) return;
    if (opts.collect) parts.push(frame);
    const level = dbfs(frameRms(frame));
    frameListeners.forEach((cb) => cb(frame, level));
  };

  let via: PcmCapture["via"] = "script-processor";
  let node: AudioNode | null = null;
  let sink: AudioNode | null = null;
  if (ctx.audioWorklet && env.createWorkletNode) {
    try {
      await ctx.audioWorklet.addModule(env.workletUrl);
      const worklet = env.createWorkletNode(ctx);
      worklet.port.onmessage = (event: MessageEvent) => handle(event.data as Float32Array);
      source.connect(worklet);
      node = worklet;
      via = "worklet";
    } catch {
      node = null;
    }
  }
  if (!node) {
    const processor = ctx.createScriptProcessor(4096, 1, 1);
    processor.onaudioprocess = (event) => handle(event.inputBuffer.getChannelData(0).slice());
    const mute = ctx.createGain();
    mute.gain.value = 0;
    source.connect(processor);
    processor.connect(mute);
    mute.connect(ctx.destination); // ScriptProcessor 需要连到输出才会工作
    node = processor;
    sink = mute;
  }
  const onEnded = () => endListeners.forEach((cb) => cb());
  tracks.forEach((t) => t.addEventListener?.("ended", onEnded));

  return {
    stream,
    context: ctx,
    via,
    onFrame(cb) {
      frameListeners.add(cb);
      return () => frameListeners.delete(cb);
    },
    onTrackEnded(cb) {
      endListeners.add(cb);
      return () => endListeners.delete(cb);
    },
    collected: () => concatFloat(parts),
    release() {
      if (released) return;
      released = true;
      frameListeners.clear();
      endListeners.clear();
      try {
        source.disconnect();
        node?.disconnect();
        sink?.disconnect();
      } catch {
        /* 已断开 */
      }
      tracks.forEach((t) => {
        t.removeEventListener?.("ended", onEnded);
        t.stop();
      });
      if (owned) void ctx.close?.()?.catch?.((): void => undefined);
    },
  };
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
 * 在第一次 click / touchend 的同步阶段解锁页面级 AudioContext(iOS 的 pointerdown 不算用户激活)。
 * 上下文进入 running 之后自动移除监听;返回手动卸载函数。
 */
export function installAudioUnlock(target: EventTarget = document, env?: CaptureEnv): () => void {
  const events = ["click", "touchend"] as const;
  const off = () => events.forEach((name) => target.removeEventListener(name, onGesture, true));
  function onGesture() {
    const ctx = getPageAudioContext(env);
    if (!ctx) return;
    unlockAudioContext(ctx);
    if (ctx.state === "running") off();
  }
  events.forEach((name) => target.addEventListener(name, onGesture, true));
  return off;
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
