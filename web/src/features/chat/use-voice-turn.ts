import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import type { ApiClient } from "~/api/client";
import { toAssessmentWav } from "~/audio/convert";
import { describeAudioError } from "~/audio/describe-error";
import type { RecorderEnv, RecordingResult } from "~/audio/recorder";
import { useRecorder, type RecordingStarter } from "~/audio/use-recorder";
import { abortLatencyTrace, finishLatencyTrace, markLatency, startLatencyTrace } from "~/lib/latency";
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
  /** 自定义录音启动器(透传给 useRecorder;测试注入 PCM 录音会话) */
  starter?: RecordingStarter;
  newKey(): string;
  /** 草稿气泡的出现与变化(转写中 / 保留待发送 / 转写失败 / 已取消) */
  onDraft(event: VoiceDraftEvent): void;
  /**
   * 转写成功:页面立即显示气泡并开始回复,同时并行评测(R1)。
   * 页面应自己保存 (clip, text):若随后聊天回复失败,重试回复只重发 text,不重新录音、不重新上传。
   */
  onTranscribed(clip: VoiceClip, text: string): void;
  /**
   * stop("fill") 的转写结果:只把文字交给页面(放进输入框),不建消息、不发送、不评测(R11)。
   */
  onTranscribedText?: (text: string) => void;
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
  /** 本次转写所属的延迟记录(停止/60 秒自动停止时开始;只用于第一次转写,重试会另开一条) */
  latencyTurn?: number;
  /** 已转写成功、等待(或重新)交给页面的结果 */
  handoff?: { text: string; audioUrl: string };
  /** 已按"没有前景语音"拦截过一次(R10);之后的重试视为用户坚持发送 */
  noSpeechChecked?: boolean;
  /** send = 转写后发送(默认);fill = 只把文字填回输入框。重试沿用同一交付方式。 */
  deliver: VoiceDeliver;
}

/** stop() 的去向:send 发送;fill 转成文字填入输入框;discard 丢弃录音(释放麦克风,不上传)。 */
export type VoiceDeliver = "send" | "fill" | "discard";

/** 60 秒自动停止与切后台/麦克风中断的草稿一律按 send(R11 的 60 秒落点由手势层先处理)。 */
const stoppedAuto = (recording: RecordingResult) => recording.stoppedBy !== "user";

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
    let turn: number | undefined;
    if (!draft.handoff) {
      if (draft.recording.noSpeech && !draft.noSpeechChecked) {
        draft.noSpeechChecked = true; // 只拦第一次:用户点"重试"即视为坚持发送
        abortLatencyTrace(draft.latencyTurn); // 没有上传:这一轮不计时
        draft.latencyTurn = undefined;
        opts.current.onDraft({ kind: "failed", key, error: tRef.current("web.chat.noSpeech") });
        return;
      }
      turn = draft.latencyTurn;
      draft.latencyTurn = undefined;
      if (turn === undefined) {
        turn = startLatencyTrace("voice"); // 重试:新的一轮,从点击"发送这段"算起
        markLatency("release", turn);
      }
    }
    const mine = { controller, key };
    inflight.current = mine;
    setProcessing(true);
    opts.current.onDraft({ kind: "transcribing", key, durationMs: draft.durationMs });
    try {
      if (!draft.handoff) {
        if (!draft.wav) {
          const converted = await toAssessmentWav(draft.recording.blob);
          draft.wav = converted.wav; // 重试时不再转换
          markLatency("audio_ready", turn);
          draft.durationMs = converted.durationMs;
        }
        if (controller.signal.aborted) {
          abortLatencyTrace(turn);
          return;
        }
        const { text } = await transcribe(opts.current.api, draft.wav, null, controller.signal);
        if (!mounted.current || controller.signal.aborted) {
          abortLatencyTrace(turn);
          return;
        }
        const clean = (text ?? "").trim();
        markLatency("transcript", turn);
        if (!clean) {
          abortLatencyTrace(turn);
          opts.current.onDraft({ kind: "failed", key, error: tRef.current("web.chat.noSpeech") });
          return;
        }
        if (draft.deliver === "fill") {
          drafts.current.delete(key);
          opts.current.onDraft({ kind: "discarded", key });
          // 转文字不发送:这一轮到此为止(不会有回复/朗读标记)。只结束自己这一轮:
          // 转写进行时用户可能已经打字发送,那一轮的记录不能被这里关掉
          finishLatencyTrace("complete", turn);
          try {
            opts.current.onTranscribedText?.(clean);
          } catch (fillError) {
            console.error("voice turn fill failed", fillError);
          }
          return;
        }
        const audioUrl = (opts.current.urls ?? browserUrls).create(draft.wav);
        urls.current.push(audioUrl);
        draft.handoff = { text: clean, audioUrl }; // 交接失败后重试只重新交接,不重新转写/上传、不再建 blob URL
      }
      const { text: clean, audioUrl } = draft.handoff;
      drafts.current.delete(key);
      try {
        opts.current.onTranscribed({ key, wav: draft.wav!, durationMs: draft.durationMs, audioUrl }, clean);
      } catch (handoffError) {
        // 页面处理转写结果时出错不是"转写失败":记录后把草稿留在 kept 状态,用户可再点发送或丢弃
        console.error("voice turn handoff failed", handoffError);
        abortLatencyTrace(turn);
        drafts.current.set(key, draft);
        if (mounted.current) {
          opts.current.onDraft({ kind: "kept", key, durationMs: draft.durationMs, note: tRef.current("web.chat.handoffFailed") });
        }
      }
    } catch (err) {
      abortLatencyTrace(turn);
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
    (recording: RecordingResult, turn?: number, deliver: Exclude<VoiceDeliver, "discard"> = "send") => {
      if (!mounted.current) {
        abortLatencyTrace(turn);
        return;
      }
      const key = opts.current.newKey();
      const draft: Draft = { recording, durationMs: recording.durationMs, deliver: stoppedAuto(recording) ? "send" : deliver };
      drafts.current.set(key, draft);
      if (recording.stoppedBy === "background" || recording.stoppedBy === "track_ended") {
        abortLatencyTrace(turn); // 没有发送:这一轮不计时,等用户点"发送这段"时另开一条
        const note = tRef.current(recording.stoppedBy === "background" ? "web.recorder.background" : "web.recorder.trackEnded", {
          seconds: Math.round(recording.durationMs / 1000),
        });
        opts.current.onDraft({ kind: "kept", key, durationMs: recording.durationMs, note });
        return; // R18:等用户点"发送这段"(retry)或"丢弃"
      }
      if (recording.stoppedBy === "max_duration") {
        turn = startLatencyTrace("voice");
        markLatency("release", turn);
      }
      draft.latencyTurn = turn;
      void transcribeDraft(key); // 用户点停止,或到 60 秒自动停止:直接发送
    },
    [transcribeDraft],
  );

  const recorder = useRecorder({ env: options.env, starter: options.starter, maxDurationMs: VOICE_MAX_MS, onAutoStop: accept });
  const { stop: stopRecorder, cancel: cancelRecorder, start: startRecorder } = recorder;
  const recorderState = useRef(recorder.state);
  recorderState.current = recorder.state;

  /** 只在空闲(无停止中、无转写)时开始;双击与重入被忽略。 */
  const start = useCallback(async () => {
    if (!mounted.current || stopping.current || inflight.current) return false;
    return startRecorder();
  }, [startRecorder]);

  const stop = useCallback(async (deliver: VoiceDeliver = "send") => {
    if (!mounted.current || stopping.current) return;
    if (deliver === "discard") {
      // 丢弃:释放麦克风,不留草稿、不上传、不计时。starting(权限弹窗还开着)也要处理:
      // useRecorder.cancel() 会在麦克风到手后立刻释放;不看 recorderState(同一事件里它可能还没更新),cancel 本身幂等
      generation.current += 1;
      cancelRecorder();
      return;
    }
    if (recorderState.current !== "recording") return;
    const gen = generation.current;
    stopping.current = true;
    const turn = startLatencyTrace("voice");
    markLatency("release", turn);
    setStoppingState(true);
    try {
      const result = await stopRecorder();
      if (result && gen === generation.current) accept(result, turn, deliver);
      else abortLatencyTrace(turn);
    } catch (err) {
      abortLatencyTrace(turn);
      throw err;
    } finally {
      if (gen === generation.current) {
        stopping.current = false;
        if (mounted.current) setStoppingState(false);
      }
    }
  }, [stopRecorder, cancelRecorder, accept]);

  /** 发送前取消:录音(starting/recording/stopping)与进行中的转写一并丢弃,释放麦克风,不留草稿。 */
  const cancel = useCallback(() => {
    abortLatencyTrace();
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
      abortLatencyTrace();
      inflight.current = null;
      current.controller.abort();
      if (mounted.current) setProcessing(false);
    }
    drafts.current.delete(key);
  }, []);

  /** 切换会话:取消录音、中止转写、清掉草稿与 blob URL。 */
  const reset = useCallback(() => {
    abortLatencyTrace();
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
      abortLatencyTrace();
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
