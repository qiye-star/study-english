import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import type { ApiClient } from "~/api/client";
import { toAssessmentWav } from "~/audio/convert";
import { describeAudioError } from "~/audio/describe-error";
import type { RecorderEnv, RecordingResult } from "~/audio/recorder";
import { useRecorder } from "~/audio/use-recorder";
import { CHAT_SERVER_ERRORS } from "./chat-api";
import { transcribe } from "./speech-api";

export const VOICE_MAX_MS = 60_000;

export interface VoiceClip {
  key: string;
  wav: Blob;
  durationMs: number;
  audioUrl: string;
}

export type VoiceDraftEvent =
  | { kind: "transcribing"; key: string; durationMs: number }
  | { kind: "kept"; key: string; durationMs: number; note: string }
  | { kind: "failed"; key: string; error: string }
  /** cancel() aborted this transcription before it finished: the page should drop the draft bubble. */
  | { kind: "discarded"; key: string };

export interface UseVoiceTurnOptions {
  api: ApiClient;
  env?: RecorderEnv;
  newKey(): string;
  /** 草稿气泡的出现与变化(转写中 / 保留待发送 / 转写失败 / 已取消) */
  onDraft(event: VoiceDraftEvent): void;
  /**
   * 转写成功:页面立即显示气泡并开始回复,同时并行评测(R1)。
   * 页面应自己保存 (clip, text):若随后聊天回复失败,重试回复只重发 text,不重新录音、不重新上传。
   */
  onTranscribed(clip: VoiceClip, text: string): void;
  urls?: { create(blob: Blob): string; revoke(url: string): void };
}

export type VoiceTurnState = "idle" | "starting" | "recording" | "processing";

/**
 * Draft lifecycle: recording → (converting →) transcribing → handed over (draft removed)
 *                                                          ↘ failed (draft kept, retry/discard)
 *                   interrupted (background / mic loss) → kept (draft kept, retry = "send this" / discard)
 */
interface Draft {
  recording: RecordingResult;
  wav?: Blob;
  durationMs: number;
}

const browserUrls = { create: (b: Blob) => URL.createObjectURL(b), revoke: (u: string) => URL.revokeObjectURL(u) };

/**
 * 语音消息的"录音 → WAV → 转写"一段,按小状态机实现。
 * 状态:idle → starting → recording → processing(停止中 / 转换 / 转写) → idle,
 * 草稿(drafts)另存:failed / kept 的音频保留,等用户重试或丢弃。
 * 约束:上一次 stop() 未完成、转写进行中都不会开始新录音(useRecorder.start 自身不防这一点);
 * 停止按钮只在 recording 可用;卸载 / cancel / reset 释放麦克风并中止转写;卸载后不再 setState。
 */
export function useVoiceTurn(options: UseVoiceTurnOptions) {
  const { t } = useTranslation();
  const tRef = useRef(t);
  tRef.current = t;
  const opts = useRef(options);
  opts.current = options;
  const drafts = useRef(new Map<string, Draft>());
  const urls = useRef<string[]>([]);
  const inflight = useRef<{ controller: AbortController; key: string } | null>(null);
  const mounted = useRef(true);
  const stopping = useRef(false); // stop() 已发出、结果尚未返回
  const generation = useRef(0); // cancel()/reset() 递增,使过期的 stop() 结果失效
  const [processing, setProcessing] = useState(false);
  const [stoppingState, setStoppingState] = useState(false);

  const revokeAll = useCallback(() => {
    const factory = opts.current.urls ?? browserUrls;
    for (const url of urls.current) {
      try {
        factory.revoke(url);
      } catch {
        /* ignore */
      }
    }
    urls.current = [];
  }, []);

  const transcribeDraft = useCallback(async (key: string) => {
    const draft = drafts.current.get(key);
    if (!draft || inflight.current || !mounted.current) return;
    const controller = new AbortController();
    const mine = { controller, key };
    inflight.current = mine;
    setProcessing(true);
    opts.current.onDraft({ kind: "transcribing", key, durationMs: draft.durationMs });
    try {
      if (!draft.wav) {
        const converted = await toAssessmentWav(draft.recording.blob);
        draft.wav = converted.wav; // 重试时不再转换
        draft.durationMs = converted.durationMs;
      }
      if (controller.signal.aborted) return;
      const { text } = await transcribe(opts.current.api, draft.wav, null, controller.signal);
      if (!mounted.current || controller.signal.aborted) return;
      const clean = (text ?? "").trim();
      if (!clean) {
        opts.current.onDraft({ kind: "failed", key, error: tRef.current("web.chat.noSpeech") });
        return;
      }
      drafts.current.delete(key);
      const audioUrl = (opts.current.urls ?? browserUrls).create(draft.wav);
      urls.current.push(audioUrl);
      try {
        opts.current.onTranscribed({ key, wav: draft.wav, durationMs: draft.durationMs, audioUrl }, clean);
      } catch (handoffError) {
        // 页面处理转写结果时出错不是"转写失败":记录后把草稿留在 kept 状态,用户可再点发送或丢弃
        console.error("voice turn handoff failed", handoffError);
        drafts.current.set(key, draft);
        if (mounted.current) {
          opts.current.onDraft({ kind: "kept", key, durationMs: draft.durationMs, note: tRef.current("web.chat.handoffFailed") });
        }
      }
    } catch (err) {
      if (mounted.current && !controller.signal.aborted) {
        opts.current.onDraft({ kind: "failed", key, error: describeAudioError(tRef.current, err, CHAT_SERVER_ERRORS) });
      }
    } finally {
      // 只有仍拥有 inflight 时才收尾:cancel()/reset() 已自行清理,新的转写可能已经开始
      if (inflight.current === mine) {
        inflight.current = null;
        if (mounted.current) setProcessing(false);
      }
    }
  }, []);

  const accept = useCallback(
    (recording: RecordingResult) => {
      if (!mounted.current) return;
      const key = opts.current.newKey();
      drafts.current.set(key, { recording, durationMs: recording.durationMs });
      if (recording.stoppedBy === "background" || recording.stoppedBy === "track_ended") {
        const note = tRef.current(recording.stoppedBy === "background" ? "web.recorder.background" : "web.recorder.trackEnded", {
          seconds: Math.round(recording.durationMs / 1000),
        });
        opts.current.onDraft({ kind: "kept", key, durationMs: recording.durationMs, note });
        return; // R18:等用户点"发送这段"(retry)或"丢弃"
      }
      void transcribeDraft(key); // 用户点停止,或到 60 秒自动停止:直接发送
    },
    [transcribeDraft],
  );

  const recorder = useRecorder({ env: options.env, maxDurationMs: VOICE_MAX_MS, onAutoStop: accept });
  const { stop: stopRecorder, cancel: cancelRecorder, start: startRecorder } = recorder;
  const recorderState = useRef(recorder.state);
  recorderState.current = recorder.state;

  /** 只在空闲(无停止中、无转写)时开始;双击与重入被忽略。 */
  const start = useCallback(async () => {
    if (!mounted.current || stopping.current || inflight.current) return false;
    return startRecorder();
  }, [startRecorder]);

  const stop = useCallback(async () => {
    if (!mounted.current || stopping.current || recorderState.current !== "recording") return;
    const gen = generation.current;
    stopping.current = true;
    setStoppingState(true);
    try {
      const result = await stopRecorder();
      if (result && gen === generation.current) accept(result);
    } finally {
      if (gen === generation.current) {
        stopping.current = false;
        if (mounted.current) setStoppingState(false);
      }
    }
  }, [stopRecorder, accept]);

  /** 发送前取消:录音(starting/recording/stopping)与进行中的转写一并丢弃,释放麦克风,不留草稿。 */
  const cancel = useCallback(() => {
    generation.current += 1;
    stopping.current = false;
    cancelRecorder();
    const current = inflight.current;
    if (current) {
      inflight.current = null;
      current.controller.abort();
      drafts.current.delete(current.key);
      if (mounted.current) opts.current.onDraft({ kind: "discarded", key: current.key });
    }
    if (mounted.current) {
      setStoppingState(false);
      setProcessing(false);
    }
  }, [cancelRecorder]);

  /** 重试转写 / 发送已保留的录音:只在完全空闲时生效;已交付的草稿不会重复上传。 */
  const retry = useCallback(
    (key: string) => {
      if (stopping.current || recorderState.current !== "idle") return;
      void transcribeDraft(key);
    },
    [transcribeDraft],
  );

  const discard = useCallback((key: string) => {
    const current = inflight.current;
    if (current?.key === key) {
      inflight.current = null;
      current.controller.abort();
      if (mounted.current) setProcessing(false);
    }
    drafts.current.delete(key);
  }, []);

  /** 切换会话:取消录音、中止转写、清掉草稿与 blob URL。 */
  const reset = useCallback(() => {
    generation.current += 1;
    stopping.current = false;
    cancelRecorder();
    inflight.current?.controller.abort();
    inflight.current = null;
    drafts.current.clear();
    revokeAll();
    if (mounted.current) {
      setStoppingState(false);
      setProcessing(false);
    }
  }, [cancelRecorder, revokeAll]);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      generation.current += 1;
      stopping.current = false;
      inflight.current?.controller.abort();
      inflight.current = null;
      drafts.current.clear();
      revokeAll(); // 麦克风由 useRecorder 自己的卸载清理释放
    };
  }, [revokeAll]);

  const state: VoiceTurnState =
    stoppingState || processing
      ? "processing"
      : recorder.state === "recording"
        ? "recording"
        : recorder.state === "starting"
          ? "starting"
          : "idle";
  return {
    state,
    elapsedMs: recorder.elapsedMs,
    error: recorder.error,
    clearError: recorder.clearError,
    /** The stop button is enabled only while truly recording. */
    canStop: state === "recording",
    /** Typing is blocked while recording or transcribing (R19). */
    blocksTyping: state !== "idle",
    start,
    stop,
    cancel,
    retry,
    discard,
    reset,
  } as const;
}
