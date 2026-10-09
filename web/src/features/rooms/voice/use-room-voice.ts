import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { transcribe } from "~/api/ai";
import { useAuth } from "~/auth/auth-context";
import { claimAudio, releaseAudio } from "~/audio/audio-focus";
import { toAssessmentWav } from "~/audio/convert";
import { describeAudioError } from "~/audio/describe-error";
import type { RecordingResult } from "~/audio/recorder";
import { useRecorder, type RecordingStarter } from "~/audio/use-recorder";
import type { DiscardReason } from "~/lib/hold-gesture";
import type { ActivityState, RoomMessage } from "../protocol";
import { ROOMS_SERVER_ERRORS } from "../rooms-api";
import { ROOM_VOICE_SERVER_ERRORS, uploadVoice } from "./voice-api";

/**
 * 房间语音录制与发送(spec 2026-10-10 §4.1–4.2;车道 WV,任务 WV1;签名为 F5 定下的最终接口,计划 P2-4)。
 * 手势与对话页相同:松手 finish("send") 上传语音;上滑「文」finish("fill") 只转文字填进输入框(不上传、不存音频);
 * target="assist" 时松手 = 转文字后 onAssistDraft(R2-12)。录音期间 onActivity("recording"),结束 onActivity("idle")
 * (只在发往群聊时广播:对助手说的话不算"正在说话")。
 * 录音沿用 useRecorder + 默认启动器(页面级 AudioContext 已解锁 → PCM 16 kHz WAV;否则 MediaRecorder,录完 toAssessmentWav),
 * 上传永远是 16 kHz 单声道 16 位 WAV。状态:starting → recording → sending | transcribing → idle。
 */
export type RoomVoiceState = "idle" | "starting" | "recording" | "sending" | "transcribing";
export interface RoomVoiceController {
  state: RoomVoiceState; elapsedMs: number; error: string | null;
  start(): Promise<boolean>; finish(deliver: "send" | "fill"): void; discard(reason: DiscardReason): void; release(): void;
}
export interface UseRoomVoiceOptions {
  roomId: string; enabled: boolean; maxMs: number; target: "group" | "assist"; replyTo: number | null;
  onFill(text: string): void; onAssistDraft(text: string): void; onSent(message: RoomMessage): void; onActivity(state: ActivityState): void;
  /** 测试注入:录音启动器(透传给 useRecorder) */
  starter?: RecordingStarter;
  /** 测试注入:上传去重用的 client_id(默认 crypto.randomUUID) */
  newId?: () => string;
}

const ERRORS = { ...ROOMS_SERVER_ERRORS, ...ROOM_VOICE_SERVER_ERRORS };
/** 手势层丢弃的提示(滑到取消落点不提示) */
const HOLD_HINTS: Partial<Record<DiscardReason, string>> = { short: "web.rooms.voice.hold.tooShort", "not-ready": "web.rooms.voice.hold.notReady" };
const defaultId = () => (typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`);
/** 录音期间不得有别的播放;别处开始播放时录音不受影响 */
const micFocus = (): void => undefined;

export function useRoomVoice(options: UseRoomVoiceOptions): RoomVoiceController {
  const { api } = useAuth();
  const { t } = useTranslation();
  const tRef = useRef(t);
  tRef.current = t;
  const opts = useRef(options);
  opts.current = options;
  const [phase, setPhase] = useState<"sending" | "transcribing" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const mounted = useRef(true);
  const busy = useRef(false); // 停止/上传/转写进行中:不开始新录音
  const generation = useRef(0); // discard/卸载递增,让过期的结果失效
  const inflight = useRef<AbortController | null>(null);
  const announced = useRef(false); // 已向房间广播 "recording"

  const quiet = useCallback(() => {
    releaseAudio(micFocus);
    if (!announced.current) return;
    announced.current = false;
    opts.current.onActivity("idle");
  }, []);

  const deliver = useCallback(async (recording: RecordingResult, mode: "send" | "fill", gen: number) => {
    const o = opts.current;
    const toText = mode === "fill" || o.target === "assist";
    const { roomId, replyTo } = o;
    const controller = new AbortController();
    inflight.current = controller;
    const stale = () => !mounted.current || gen !== generation.current || controller.signal.aborted;
    try {
      if (recording.noSpeech) {
        setError(tRef.current("web.rooms.voice.noSpeech")); // PCM 路径判定没有前景语音:不上传一段静音
        return;
      }
      const wav = recording.mimeType === "audio/wav" ? recording.blob : (await toAssessmentWav(recording.blob)).wav;
      if (stale()) return;
      if (toText) {
        const { text } = await transcribe(api, wav, null, controller.signal); // 不带语言提示:保留原语言
        if (stale()) return;
        const clean = (text ?? "").trim();
        if (!clean) setError(tRef.current("web.rooms.voice.noSpeech"));
        else if (mode === "fill") opts.current.onFill(clean);
        else opts.current.onAssistDraft(clean);
        return;
      }
      const { message } = await uploadVoice(api, roomId, wav, (o.newId ?? defaultId)(), replyTo);
      if (stale()) return;
      opts.current.onSent(message);
    } catch (err) {
      if (!stale()) setError(describeAudioError(tRef.current, err, ERRORS));
    } finally {
      if (inflight.current === controller) {
        inflight.current = null;
        busy.current = false;
        if (mounted.current) setPhase(null);
      }
    }
  }, [api]);

  const onAutoStop = useCallback((recording: RecordingResult) => {
    // 录音自己结束:到上限(手势层通常先 250 ms 结束)→ 照常发送;切后台 / 麦克风中断 → 不在群里发半句话
    quiet();
    if (!mounted.current || busy.current) return;
    if (recording.stoppedBy !== "max_duration") {
      setError(tRef.current("web.rooms.voice.interrupted"));
      return;
    }
    busy.current = true;
    setPhase(opts.current.target === "assist" ? "transcribing" : "sending");
    void deliver(recording, "send", generation.current);
  }, [deliver, quiet]);

  const recorder = useRecorder({ maxDurationMs: options.maxMs, starter: options.starter, onAutoStop });
  const { start: startRecorder, stop: stopRecorder, cancel: cancelRecorder } = recorder;

  const start = useCallback(async () => {
    if (!mounted.current || busy.current || !opts.current.enabled) return false;
    setError(null);
    claimAudio(micFocus); // 先让正在播的语音/朗读停下(同步阶段)
    if (opts.current.target === "group") {
      announced.current = true;
      opts.current.onActivity("recording");
    }
    const ok = await startRecorder();
    if (!ok) quiet();
    return ok;
  }, [startRecorder, quiet]);

  const finish = useCallback((mode: "send" | "fill") => {
    if (!mounted.current || busy.current) return;
    busy.current = true;
    const gen = generation.current;
    setPhase(mode === "fill" || opts.current.target === "assist" ? "transcribing" : "sending");
    void stopRecorder().then((result) => {
      quiet();
      if (result && mounted.current && gen === generation.current) return deliver(result, mode, gen);
      busy.current = false;
      if (mounted.current) setPhase(null);
    });
  }, [stopRecorder, deliver, quiet]);

  const discard = useCallback((reason: DiscardReason) => {
    generation.current += 1;
    cancelRecorder(); // starting(权限弹窗还开着)也会在麦克风到手后立刻释放
    quiet();
    if (!inflight.current) {
      busy.current = false;
      setPhase(null);
    }
    const hint = HOLD_HINTS[reason];
    setError(hint ? tRef.current(hint) : null);
  }, [cancelRecorder, quiet]);

  /** 松手的同步阶段:播放解锁由 VoiceInput 做(primeAudioElement),这里没有别的事要在手势内完成。 */
  const release = useCallback((): void => undefined, []);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      generation.current += 1;
      inflight.current?.abort();
      inflight.current = null;
      quiet(); // 麦克风由 useRecorder 自己的卸载清理释放
    };
  }, [quiet]);

  const recorderError = recorder.error ? describeAudioError(t, recorder.error) : null;
  const state: RoomVoiceState = phase ?? (recorder.state === "recording" ? "recording" : recorder.state === "starting" ? "starting" : "idle");
  return { state, elapsedMs: recorder.elapsedMs, error: error ?? recorderError, start, finish, discard, release };
}
