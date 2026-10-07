import { browserCaptureEnv, startPcmCapture, type CaptureEnv } from "./capture";
import { hasForegroundSpeech, trimSilence } from "./energy-gate";
import { TARGET_RATE } from "./pcm";
import type { RecorderEnv, RecordingResult, RecordingSession, StopReason } from "./recorder";
import { encodeWavPcm16 } from "./wav";

export type PcmRecordingEnv = CaptureEnv & Pick<RecorderEnv, "now" | "document" | "setTimeout" | "clearTimeout">;

export function browserPcmRecordingEnv(): PcmRecordingEnv {
  return {
    ...browserCaptureEnv(),
    now: () => Date.now(),
    document,
    setTimeout: (fn, ms) => window.setTimeout(fn, ms),
    clearTimeout: (handle) => window.clearTimeout(handle as number),
  };
}

/**
 * 与 MediaRecorder 版 startRecording 相同的契约;停止即出结果(无 2 s 兜底),结果已是 16 kHz WAV(R9)。
 * `context`:页面级共享的 AudioContext(R31,`decideCapture()` 给出);传入时只借用、不关闭。
 * 没有前景语音(R10)时 `noSpeech: true`,`blob` 保留未裁剪的原始录音,便于用户"仍然发送"。
 */
export async function startPcmRecording(
  options: { maxDurationMs?: number; env?: PcmRecordingEnv; context?: AudioContext } = {},
): Promise<RecordingSession> {
  const env = options.env ?? browserPcmRecordingEnv();
  const capture = await startPcmCapture({ env, context: options.context, collect: true });
  const startedAt = env.now();
  let settled = false;
  let timer: unknown;
  let resolve!: (r: RecordingResult) => void;
  const result = new Promise<RecordingResult>((r) => (resolve = r));

  const cleanup = () => {
    if (timer !== undefined) env.clearTimeout(timer);
    env.document.removeEventListener("visibilitychange", onVisibility);
    capture.release();
  };
  const finish = (why: StopReason) => {
    if (settled) return;
    settled = true;
    const samples = capture.collected(); // 同步取走已收集的样本,再释放麦克风
    cleanup();
    const opts = { sampleRate: TARGET_RATE };
    const noSpeech = !hasForegroundSpeech(samples, opts);
    const kept = noSpeech ? samples : trimSilence(samples, opts);
    resolve({
      blob: new Blob([encodeWavPcm16(kept, TARGET_RATE)], { type: "audio/wav" }),
      mimeType: "audio/wav",
      durationMs: Math.round((kept.length / TARGET_RATE) * 1000),
      stoppedBy: why,
      noSpeech,
    });
  };
  function onVisibility() {
    if (env.document.visibilityState === "hidden") finish("background");
  }
  env.document.addEventListener("visibilitychange", onVisibility);
  capture.onTrackEnded(() => finish("track_ended"));
  if (options.maxDurationMs) timer = env.setTimeout(() => finish("max_duration"), options.maxDurationMs);
  return {
    startedAt,
    result,
    stop: () => {
      finish("user");
      return result;
    },
    cancel: () => {
      if (settled) return;
      settled = true;
      cleanup();
    },
  };
}
