import { dbfs, frameRms } from "./pcm";
import { SpeechGate, VAD_PRESETS, type VadSensitivity } from "./speech-gate";

export const VAD_FRAME_MS = 32; // Silero v5:16 kHz 下 512 个采样一帧

/**
 * @ricky0123/vad-web 0.0.31 的 `MicVAD` 接受外部 `audioContext`(核对见 spike 结论第 5 节),
 * 所以通话可以把页面级 AudioContext 交给 VAD(计划 R31/R32)。为 false 时通话应以"按住说话"开始。
 */
export const VAD_ACCEPTS_EXTERNAL_CONTEXT = true;

export interface ProbabilitySource {
  start(): void;
  pause(): void;
  destroy(): Promise<void>;
}

export type ProbabilityLoader = (opts: {
  stream: MediaStream;
  onFrame(prob: number, frame: Float32Array): void;
  /** 通话的 AudioContext(R32);不传时库自建并在 destroy 时关闭。 */
  context?: AudioContext;
}) => Promise<ProbabilitySource>;

export interface VadCallbacks {
  onSpeechStart(): void;
  onSpeechEnd(durationMs: number): void;
}

export interface VadHandle {
  start(): void;
  pause(): void;
  setSensitivity(s: VadSensitivity): void;
  destroy(): Promise<void>;
}

const ignore = (): void => undefined;

/**
 * 懒加载 @ricky0123/vad-web(只在开始通话时下载模型与 wasm;资源同源自托管,R18)。
 * 加载时就建好音频图并立即暂停:worklet/模型加载失败在这里 reject,调用方据此退到"按住说话"。
 */
export const loadSileroSource: ProbabilityLoader = async ({ stream, onFrame, context }) => {
  const { MicVAD } = await import("@ricky0123/vad-web");
  const vad = await MicVAD.new({
    model: "v5",
    baseAssetPath: __VAD_ASSET_BASE__,
    onnxWASMBasePath: __VAD_ASSET_BASE__,
    audioContext: context,
    getStream: async () => stream,
    // 默认实现会 stop() 共享麦克风流的轨道并重新 getUserMedia(R32):改为什么都不做
    pauseStream: async () => undefined,
    resumeStream: async (s: MediaStream) => s,
    startOnLoad: false,
    // 库自身的阈值放到最宽:是否算"说话"由 SpeechGate 决定
    positiveSpeechThreshold: 0.3,
    negativeSpeechThreshold: 0.25,
    onFrameProcessed: (probs, frame) => onFrame(probs.isSpeech, frame),
    onSpeechStart: ignore,
    onSpeechEnd: ignore,
    onVADMisfire: ignore,
    onSpeechRealStart: ignore,
  });
  try {
    await vad.start();
    await vad.pause();
  } catch (err) {
    await releaseFailedLoad(vad);
    throw err;
  }
  return {
    start: () => void vad.start().catch(ignore),
    pause: () => void vad.pause().catch(ignore),
    destroy: async () => {
      await vad.destroy();
      // 传入外部 AudioContext 时库不会关闭它,也不断开自己的处理节点(ScriptProcessor 连着 destination):手动断开
      try {
        (vad as unknown as { _vadNode?: AudioNode | null })._vadNode?.disconnect();
      } catch {
        // 已断开
      }
    },
  };
};

/** 库在 start() 半途失败时 destroy() 会先抛错(节点为 null)而不释放模型:按库的内部字段逐项尽力释放。 */
async function releaseFailedLoad(vad: unknown): Promise<void> {
  const v = vad as {
    model?: { release(): Promise<void> };
    ownsAudioContext?: boolean;
    _audioContext?: { close(): Promise<void> } | null;
    _vadNode?: AudioNode | null;
    _mediaStreamAudioSourceNode?: AudioNode | null;
  };
  for (const node of [v._mediaStreamAudioSourceNode, v._vadNode]) {
    try {
      node?.disconnect();
    } catch {
      // 已断开
    }
  }
  try {
    await v.model?.release();
  } catch {
    // 尽力而为:保留原始错误
  }
  // 只关库自建的 AudioContext;通话传入的由通话负责(R32)
  try {
    if (v.ownsAudioContext) await v._audioContext?.close();
  } catch {
    // 同上
  }
}

export async function createVad(
  stream: MediaStream,
  callbacks: VadCallbacks,
  loader: ProbabilityLoader = loadSileroSource,
  context?: AudioContext,
): Promise<VadHandle> {
  const gate = new SpeechGate(VAD_FRAME_MS, VAD_PRESETS.normal);
  let destroyed = false;
  const source = await loader({
    stream,
    context,
    onFrame(prob, frame) {
      if (destroyed) return;
      for (const event of gate.push(prob, dbfs(frameRms(frame)))) {
        if (event.type === "speech-start") callbacks.onSpeechStart();
        else callbacks.onSpeechEnd(event.durationMs);
      }
    },
  });
  let destroying: Promise<void> | null = null;
  return {
    start: () => source.start(),
    pause() {
      source.pause();
      // 暂停时门可能还停在"说话"中:不复位的话,恢复后的第一句只会被当成延续,不会再报 speech-start
      gate.reset();
    },
    setSensitivity: (s) => gate.setPreset(VAD_PRESETS[s]),
    destroy() {
      destroyed = true;
      destroying ??= source.destroy();
      return destroying;
    },
  };
}
