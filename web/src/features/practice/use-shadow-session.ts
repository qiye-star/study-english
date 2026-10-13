import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { ApiError } from "~/api/client";
import { toAssessmentWav } from "~/audio/convert";
import { describeAudioError } from "~/audio/describe-error";
import type { RecorderEnv, RecordingResult } from "~/audio/recorder";
import { useRecorder, type RecordingStarter } from "~/audio/use-recorder";
import { useAuth } from "~/auth/auth-context";
import {
  PRACTICE_SERVER_ERRORS, assessPronunciation, briefWords, type AssessmentScores, type AssessmentWordBrief,
} from "./assessment-api";

export type ShadowPhase = "idle" | "recording" | "assessing" | "result" | "error";

export interface ShadowSessionResult {
  assessmentId: string;
  scores: AssessmentScores;
  words: AssessmentWordBrief[];
}

export interface ShadowSessionOptions {
  /** 参考文本;上传前 trim */
  reference: string;
  recorderEnv?: RecorderEnv;
  /** 测试注入的录音启动器(透传给 useRecorder) */
  starter?: RecordingStarter;
  /** 录音上限;缺省沿用 useRecorder 的默认(练习页:5 分钟) */
  maxDurationMs?: number;
  /** 每次真正开始录音之前同步调用:停掉范读 / 我的录音,不把扬声器录进麦克风;getUserMedia 仍在这次点按的手势里 */
  beforeRecord?: () => void;
  /** 评测并保存成功后调用(练习页:跳到完整详情页);弹窗不传,结果留在 session.result */
  onAssessed?: (assessmentId: string) => void;
  /** 保留转换后的 WAV 的 blob URL(session.mineUrl),供「我的录音」播放。默认关:练习页不需要,jsdom 里也没有 createObjectURL */
  keepAudio?: boolean;
  /** 传入时,PCM 路径判定没有前景语音的录音不上传,直接报这条错误;练习页不传(行为不变) */
  silenceError?: string;
}

/**
 * 「录音 → 16 kHz WAV → 评测并保存 → 保留录音以便重试」的状态机(spec 2026-10-14-shadow-sheet §3.1)。
 * 原样取自练习页(上传前 setKept 保留录音、submitting 防重复提交、成功后先 setKept(null) 再回调、卸载中止上传),
 * 练习页与跟读弹窗共用;默认选项下与练习页原逻辑逐字等价,由 practice-page.test.tsx 兜底。
 * 评测不带 source:服务端缺省 "practice",成绩出现在练习历史里(R-S03)。
 */
export function useShadowSession(options: ShadowSessionOptions) {
  const { reference, recorderEnv, starter, maxDurationMs, keepAudio = false } = options;
  const { t } = useTranslation();
  const { api } = useAuth();
  const [busy, setBusy] = useState(false);
  const [kept, setKept] = useState<RecordingResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<ShadowSessionResult | null>(null);
  const [mineUrl, setMineUrl] = useState<string | null>(null);
  const mounted = useRef(true);
  const submitting = useRef(false);
  const inflight = useRef<AbortController | null>(null);
  const gen = useRef(0); // reset() 之后,迟到的上传结果与错误一律丢弃
  const urlRef = useRef<string | null>(null);
  const optionsRef = useRef(options);
  optionsRef.current = options;

  const setMine = useCallback((url: string | null) => {
    if (urlRef.current) URL.revokeObjectURL(urlRef.current);
    urlRef.current = url;
    setMineUrl(url);
  }, []);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      inflight.current?.abort(); // 卸载时中止进行中的上传
      if (urlRef.current) {
        URL.revokeObjectURL(urlRef.current);
        urlRef.current = null;
      }
    };
  }, []);

  const submit = useCallback(
    async (recording: RecordingResult) => {
      if (submitting.current) return; // 防止重复提交
      submitting.current = true;
      const g = gen.current;
      setKept(recording); // 上传成功前一直保留录音,失败后可重试
      setBusy(true);
      setError(null);
      const controller = new AbortController();
      inflight.current = controller;
      try {
        const silence = optionsRef.current.silenceError;
        if (silence && recording.noSpeech) {
          setKept(null);
          setError(silence);
          return;
        }
        const { wav } = await toAssessmentWav(recording.blob);
        if (g !== gen.current) return;
        if (keepAudio) setMine(URL.createObjectURL(wav));
        const res = await assessPronunciation(api, { wav, reference: reference.trim(), language: "en-US", save: true, signal: controller.signal });
        if (!mounted.current || g !== gen.current) return;
        if (!res.assessmentId) throw new ApiError(500, "Could not save the recording");
        setKept(null);
        setResult({
          assessmentId: res.assessmentId,
          scores: {
            pronunciationScore: res.pronunciationScore,
            accuracyScore: res.accuracyScore,
            fluencyScore: res.fluencyScore,
            completenessScore: res.completenessScore,
          },
          words: briefWords(res.detailResult?.words),
        });
        optionsRef.current.onAssessed?.(res.assessmentId);
      } catch (err) {
        // 非 JSON 的 2xx 等未知错误由 translateServerError 落到通用文案
        if (mounted.current && g === gen.current) setError(describeAudioError(t, err, PRACTICE_SERVER_ERRORS));
      } finally {
        if (g === gen.current) {
          submitting.current = false;
          if (inflight.current === controller) inflight.current = null;
          if (mounted.current) setBusy(false);
        }
      }
    },
    [api, reference, t, keepAudio, setMine],
  );

  const recorder = useRecorder({
    env: recorderEnv,
    starter,
    maxDurationMs,
    onAutoStop: (rec) => (rec.stoppedBy === "max_duration" ? void submit(rec) : setKept(rec)),
  });
  const cancelRecorder = recorder.cancel;

  const toggle = async () => {
    if (recorder.state === "recording") {
      const rec = await recorder.stop();
      if (rec) await submit(rec);
      return;
    }
    if (recorder.state !== "idle") return; // "starting" 时 stop() 无效,不允许操作
    setError(null);
    setKept(null);
    setResult(null);
    setMine(null);
    optionsRef.current.beforeRecord?.(); // 同步动作,getUserMedia 仍在这次点按的手势里
    await recorder.start();
  };

  const assessKept = () => (kept ? submit(kept) : Promise.resolve());
  const discardKept = () => {
    setKept(null);
    setError(null);
  };

  /** 丢弃一切:中止上传、取消录音、清空状态。换句 / 再练一次用;练习页不用。 */
  const reset = useCallback(() => {
    gen.current += 1;
    inflight.current?.abort();
    inflight.current = null;
    submitting.current = false;
    cancelRecorder();
    setBusy(false);
    setKept(null);
    setError(null);
    setResult(null);
    setMine(null);
  }, [cancelRecorder, setMine]);

  const recording = recorder.state === "recording";
  const shownError = error ?? (recorder.error ? describeAudioError(t, recorder.error) : null);
  const phase: ShadowPhase = busy ? "assessing" : recording ? "recording" : shownError || kept ? "error" : result ? "result" : "idle";
  return {
    phase,
    busy,
    recording,
    starting: recorder.state === "starting",
    recorderState: recorder.state,
    elapsedMs: recorder.elapsedMs,
    kept,
    error: shownError,
    result,
    mineUrl,
    toggle,
    assessKept,
    discardKept,
    reset,
  };
}
