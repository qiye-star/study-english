import { blobToArrayBuffer, parseAssessmentWav, toAssessmentWav } from "~/audio/convert";
import { decideCapture, startPcmCapture } from "~/audio/capture";
import { FRAME_MS, MIN_SPEECH_MS, NEAR_FIELD_DBFS, frameLevels, hasForegroundSpeech, speechRuns } from "~/audio/energy-gate";
import { startRecording } from "~/audio/recorder";
import { encodeWavPcm16 } from "~/audio/wav";

/**
 * 整段采集与按句切片(计划 L5 R13/W5)。点「开始录制」的同步阶段就开麦一次(`startTakeCapture` 同步调用采集器),
 * 之后只按窗口切片:PCM 路径在窗口关闭时切出一句(不裁静音);回落的 MediaRecorder 路径在 finish() 时按相对录音起点切。
 * 不改 audio/:只用它的公共导出,依赖通过 CaptureDeps 注入,测试用假件。
 */

export const TAKE_RATE = 16000;

export interface PcmLike {
  onFrame(cb: (frame16k: Float32Array, dbfs: number) => void): () => void;
  onTrackEnded(cb: () => void): () => void;
  release(): void;
}

export interface RecordingLike {
  stop(): Promise<{ blob: Blob; durationMs: number }>;
  cancel(): void;
}

export interface CaptureDeps {
  /** decideCapture:同步判定走 PCM 还是 MediaRecorder */
  decide(): { mode: "pcm"; context: AudioContext } | { mode: "media-recorder" };
  /** startPcmCapture({ context, collect: false }):整段一次开麦 */
  startPcm(context: AudioContext): Promise<PcmLike>;
  /** startRecording:回落路径整段一次录音 */
  startRecorder(): Promise<RecordingLike>;
  /** 回落路径:录音 Blob → 16 kHz 单声道样本(toAssessmentWav + parseAssessmentWav) */
  toSamples(recording: Blob): Promise<Float32Array | null>;
  /** 切后台(visibilitychange)时调用 onHide;返回取消订阅 */
  subscribeHidden(onHide: () => void): () => void;
}

export interface LineClip {
  idx: number;
  /** 窗口开始时的媒体毫秒(相对视频) */
  recStartMs: number;
  capture: "pcm" | "recorder";
  noSpeech: boolean;
  /** 能量门限测得的有声毫秒;无声为 null */
  voicedMs: number | null;
  durationMs: number;
  /** 无声时为 null(不花上游的钱) */
  wav: Blob | null;
}

export interface TakeCapture {
  readonly mode: "pcm" | "media-recorder";
  /** 麦克风就绪(或失败)。失败时调用方应显示错误并 release()。 */
  readonly ready: Promise<void>;
  open(idx: number, mediaMs: number): void;
  /** PCM:返回本句的切片。回落:返回 null,切片在 finish() 时给出。打断后返回 null。 */
  close(idx: number, mediaMs?: number): LineClip | null;
  /** 停止采集;回落路径在这里切出所有等待的句子,PCM 路径返回 []。 */
  finish(): Promise<LineClip[]>;
  /** 释放麦克风、取消订阅;之后不再产生切片。 */
  release(): void;
}

interface OpenWindow {
  idx: number;
  recStartMs: number;
  frames: Float32Array[];
}

interface SpanWindow {
  idx: number;
  startMs: number;
  endMs: number;
}

const concat = (parts: Float32Array[]): Float32Array => {
  const total = parts.reduce((n, p) => n + p.length, 0);
  const out = new Float32Array(total);
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }
  return out;
};

/** 能量门限测得的有声毫秒:连续有声段(至少 250 ms)的总长。 */
export function voicedMsOf(samples: Float32Array): number {
  const runs = speechRuns(frameLevels(samples, TAKE_RATE), NEAR_FIELD_DBFS, Math.ceil(MIN_SPEECH_MS / FRAME_MS));
  return runs.reduce((n, [a, b]) => n + (b - a), 0) * FRAME_MS;
}

export function clipOf(idx: number, recStartMs: number, samples: Float32Array, capture: "pcm" | "recorder"): LineClip {
  const durationMs = Math.round((samples.length * 1000) / TAKE_RATE);
  if (!hasForegroundSpeech(samples, { sampleRate: TAKE_RATE })) {
    return { idx, recStartMs, capture, noSpeech: true, voicedMs: null, durationMs, wav: null };
  }
  const wav = new Blob([encodeWavPcm16(samples, TAKE_RATE)], { type: "audio/wav" });
  return { idx, recStartMs, capture, noSpeech: false, voicedMs: voicedMsOf(samples), durationMs, wav };
}

/**
 * 同步开麦:调用时立刻调用 deps 的采集器(不得在它之前 await),之后按窗口切片。
 * `startMediaMs` 是录音开始时的媒体毫秒,回落路径用它把窗口换算成录音内的位置。
 */
export function startTakeCapture(deps: CaptureDeps, startMediaMs: number, onInterrupted: () => void): TakeCapture {
  const decision = deps.decide();
  let released = false;
  let interrupted = false;
  let openWin: OpenWindow | null = null;
  const spans: SpanWindow[] = [];
  let pcm: PcmLike | null = null;
  let unsubs: Array<() => void> = [];
  let session: RecordingLike | null = null;
  const unsubHidden = deps.subscribeHidden(() => interrupt());

  function releaseAll() {
    released = true;
    for (const u of unsubs) u();
    unsubs = [];
    unsubHidden();
    pcm?.release();
    session?.cancel();
  }

  function interrupt() {
    if (interrupted || released) return;
    interrupted = true;
    openWin = null;
    releaseAll();
    onInterrupted();
  }

  let ready: Promise<void>;
  if (decision.mode === "pcm") {
    const started = deps.startPcm(decision.context);
    ready = started.then((p) => {
      if (released) {
        p.release();
        return;
      }
      pcm = p;
      unsubs = [
        p.onFrame((frame) => {
          if (openWin) openWin.frames.push(new Float32Array(frame));
        }),
        p.onTrackEnded(() => interrupt()),
      ];
    });
    ready.catch(() => { released = true; unsubHidden(); });
  } else {
    // 回落:整段一次录音,同样在同步阶段发起。
    const started = deps.startRecorder();
    ready = started.then((s) => {
      if (released) {
        s.cancel();
        return;
      }
      session = s;
    });
    ready.catch(() => { released = true; unsubHidden(); });
  }

  const mode = decision.mode === "pcm" ? "pcm" : "media-recorder";

  return {
    mode,
    ready,
    open(idx, mediaMs) {
      if (released || interrupted) return;
      openWin = { idx, recStartMs: mediaMs, frames: [] };
    },
    close(idx, mediaMs) {
      if (!openWin || openWin.idx !== idx || interrupted) return null;
      const win = openWin;
      openWin = null;
      if (mode === "pcm") return clipOf(idx, win.recStartMs, concat(win.frames), "pcm");
      spans.push({ idx, startMs: win.recStartMs, endMs: mediaMs ?? win.recStartMs });
      return null;
    },
    async finish() {
      if (mode === "pcm") {
        releaseAll();
        return [];
      }
      await ready;
      if (!session) return [];
      const rec = await session.stop();
      unsubHidden();
      const samples = await deps.toSamples(rec.blob);
      return spans.map((w): LineClip => {
        if (!samples) return { idx: w.idx, recStartMs: w.startMs, capture: "recorder", noSpeech: true, voicedMs: null, durationMs: 0, wav: null };
        const from = Math.max(0, Math.round(((w.startMs - startMediaMs) * TAKE_RATE) / 1000));
        const to = Math.min(samples.length, Math.round(((w.endMs - startMediaMs) * TAKE_RATE) / 1000));
        return clipOf(w.idx, w.startMs, samples.subarray(from, Math.max(from, to)), "recorder");
      });
    },
    release() {
      openWin = null;
      releaseAll();
    },
  };
}

/** 浏览器的真实依赖(只在 W6 的 useDubTake 中使用)。 */
export function browserCaptureDeps(): CaptureDeps {
  return {
    decide: () => decideCapture(),
    startPcm: (context) => startPcmCapture({ context, collect: false }),
    startRecorder: () => startRecording(),
    toSamples: async (recording) => {
      const { wav } = await toAssessmentWav(recording);
      return parseAssessmentWav(await blobToArrayBuffer(wav));
    },
    subscribeHidden: (onHide) => {
      const handler = () => { if (document.hidden) onHide(); };
      document.addEventListener("visibilitychange", handler);
      return () => document.removeEventListener("visibilitychange", handler);
    },
  };
}
