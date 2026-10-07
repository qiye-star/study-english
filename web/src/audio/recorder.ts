export type RecorderErrorCode = "insecure_context" | "unsupported" | "permission_denied" | "no_device" | "mic_busy" | "failed";

export class RecorderError extends Error {
  constructor(public readonly code: RecorderErrorCode, message?: string) {
    super(message ?? code);
    this.name = "RecorderError";
  }
}

export type StopReason = "user" | "max_duration" | "background" | "track_ended";

export interface RecordingResult {
  blob: Blob;
  mimeType: string;
  durationMs: number;
  stoppedBy: StopReason;
  /** PCM 采集:能量门限判定没有前景语音(R10)。MediaRecorder 路径不设置。 */
  noSpeech?: boolean;
}

export interface RecordingSession {
  readonly startedAt: number;
  readonly result: Promise<RecordingResult>;
  stop(): Promise<RecordingResult>;
  cancel(): void;
}

export interface RecorderEnv {
  isSecureContext: boolean;
  getUserMedia?: (constraints: MediaStreamConstraints) => Promise<MediaStream>;
  MediaRecorder?: new (stream: MediaStream) => MediaRecorder;
  now(): number;
  document: Pick<Document, "visibilityState" | "addEventListener" | "removeEventListener">;
  setTimeout(fn: () => void, ms: number): unknown;
  clearTimeout(handle: unknown): void;
}

const STOP_FALLBACK_MS = 2000;

export const AUDIO_CONSTRAINTS: MediaStreamConstraints = {
  audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
};

export function browserRecorderEnv(): RecorderEnv {
  const devices = typeof navigator !== "undefined" ? navigator.mediaDevices : undefined;
  return {
    isSecureContext: typeof window !== "undefined" && window.isSecureContext,
    getUserMedia: devices?.getUserMedia ? (c) => devices.getUserMedia(c) : undefined,
    MediaRecorder: typeof MediaRecorder === "undefined" ? undefined : MediaRecorder,
    now: () => Date.now(),
    document,
    setTimeout: (fn, ms) => window.setTimeout(fn, ms),
    clearTimeout: (handle) => window.clearTimeout(handle as number),
  };
}

export function mapGetUserMediaError(err: unknown): RecorderError {
  const name = (err as { name?: string })?.name;
  if (name === "NotAllowedError" || name === "SecurityError") return new RecorderError("permission_denied");
  if (name === "NotReadableError") return new RecorderError("mic_busy");
  if (name === "NotFoundError" || name === "OverconstrainedError") return new RecorderError("no_device");
  return new RecorderError("failed", String(err));
}

/** 不指定 mimeType,由浏览器决定(Chrome 多为 webm/opus,Safari 为 mp4/aac)。 */
export async function startRecording(options: { maxDurationMs?: number; env?: RecorderEnv } = {}): Promise<RecordingSession> {
  const env = options.env ?? browserRecorderEnv();
  if (!env.isSecureContext) throw new RecorderError("insecure_context");
  if (!env.getUserMedia || !env.MediaRecorder) throw new RecorderError("unsupported");
  let stream: MediaStream;
  try {
    stream = await env.getUserMedia(AUDIO_CONSTRAINTS);
  } catch (err) {
    throw mapGetUserMediaError(err);
  }
  const tracks = stream.getTracks();
  let recorder: MediaRecorder;
  try {
    recorder = new env.MediaRecorder(stream);
  } catch (err) {
    tracks.forEach((t) => t.stop());
    throw new RecorderError("unsupported", String(err));
  }

  const chunks: Blob[] = [];
  const startedAt = env.now();
  let reason: StopReason = "user";
  let stopping = false;
  let settled = false;
  let timer: unknown;
  let fallbackTimer: unknown;
  let resolveResult!: (value: RecordingResult) => void;
  let rejectResult!: (reason: unknown) => void;
  const result = new Promise<RecordingResult>((resolve, reject) => {
    resolveResult = resolve;
    rejectResult = reject;
  });

  const onVisibility = () => {
    if (env.document.visibilityState === "hidden") finish("background");
  };
  const onEnded = () => finish("track_ended");
  const cleanup = () => {
    if (timer !== undefined) env.clearTimeout(timer);
    if (fallbackTimer !== undefined) env.clearTimeout(fallbackTimer);
    env.document.removeEventListener("visibilitychange", onVisibility);
    tracks.forEach((t) => {
      t.removeEventListener?.("ended", onEnded);
      t.stop();
    });
  };
  const onStop = () => {
    if (settled) return;
    settled = true;
    cleanup();
    const mimeType = recorder.mimeType || chunks[0]?.type || "";
    resolveResult({
      blob: new Blob(chunks, mimeType ? { type: mimeType } : undefined),
      mimeType,
      durationMs: env.now() - startedAt,
      stoppedBy: reason,
    });
  };
  function finish(why: StopReason) {
    if (stopping) return;
    stopping = true;
    reason = why;
    if (recorder.state === "inactive") return onStop();
    try {
      recorder.stop();
      // Safari 有时不触发 stop 事件:兜底强制结束,确保释放麦克风、Promise 落定。
      fallbackTimer = env.setTimeout(onStop, STOP_FALLBACK_MS);
    } catch {
      onStop();
    }
  }

  recorder.addEventListener("dataavailable", (event) => {
    const data = (event as BlobEvent).data;
    if (data && data.size > 0) chunks.push(data);
  });
  recorder.addEventListener("stop", onStop);
  recorder.addEventListener("error", (event) => {
    if (settled) return;
    settled = true;
    cleanup();
    if (chunks.length > 0) {
      // 出错但已有数据:保留已录内容,不丢用户的录音。
      const mimeType = recorder.mimeType || chunks[0]?.type || "";
      resolveResult({
        blob: new Blob(chunks, mimeType ? { type: mimeType } : undefined),
        mimeType,
        durationMs: env.now() - startedAt,
        stoppedBy: "track_ended",
      });
      return;
    }
    rejectResult(new RecorderError("failed", String((event as Event & { error?: unknown }).error ?? "MediaRecorder error")));
  });
  env.document.addEventListener("visibilitychange", onVisibility);
  tracks.forEach((t) => t.addEventListener?.("ended", onEnded));
  if (options.maxDurationMs) timer = env.setTimeout(() => finish("max_duration"), options.maxDurationMs);
  try {
    recorder.start(1000);
  } catch (err) {
    settled = true;
    stopping = true;
    cleanup();
    throw new RecorderError("failed", String(err));
  }

  return {
    startedAt,
    result,
    stop: () => {
      finish("user");
      return result;
    },
    // 已在停止中(等 stop 事件)时 cancel 要立刻释放麦克风,不等事件/兜底定时器
    cancel: () => (stopping ? onStop() : finish("user")),
  };
}
