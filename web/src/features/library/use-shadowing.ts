import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { ApiError } from "~/api/client";
import { claimAudio, releaseAudio } from "~/audio/audio-focus";
import { toAssessmentWav } from "~/audio/convert";
import { describeAudioError } from "~/audio/describe-error";
import type { RecordingResult } from "~/audio/recorder";
import { useRecorder, type RecordingStarter } from "~/audio/use-recorder";
import { useAuth } from "~/auth/auth-context";
import {
  PRACTICE_SERVER_ERRORS, assessPronunciation, briefWords, type AssessmentScores, type AssessmentWordBrief,
} from "~/features/practice";
import { loadBest, noteAttempt, peekBest, recordAttempt, type SegmentBest } from "./attempts-api";
import "./locales";

/** 单句录音上限(plan W2 R-SH10):句子最长 14 s(spec §6.3),60 s 足够且远低于服务端的 300 s。 */
export const SHADOW_MAX_MS = 60_000;

export type ShadowPhase = "idle" | "starting" | "recording" | "assessing" | "done" | "error";

export interface ShadowTarget {
  idx: number;
  text: string;
}

export interface ShadowResult {
  segIdx: number;
  scores: AssessmentScores;
  words: AssessmentWordBrief[];
  assessmentId: string;
  /** POST attempts 是否成功(失败时只展示分数,不更新最好成绩,R-SH14) */
  attemptSaved: boolean;
}

export interface UseShadowingOptions {
  itemId: string;
  segment: ShadowTarget | null;
  /** 暂停库的媒体(W1 播放器);录音与播放不并行(R-SH12) */
  pauseMedia: () => void;
  /** 测试注入的录音启动器(透传给 useRecorder) */
  starter?: RecordingStarter;
}

type OwnPhase = "idle" | "assessing" | "done" | "error";

/**
 * 跟读一句(spec §11.4):开麦前同步暂停媒体 → useRecorder 录音 → 16 kHz WAV → POST /api/speech/assessments
 * (source=library,参考文本 = 句子原文)→ POST attempts。换句 / 改字 / 卸载即复位并丢弃迟到的结果(R-SH17)。
 */
export function useShadowing({ itemId, segment, pauseMedia, starter }: UseShadowingOptions) {
  const { api } = useAuth();
  const { t } = useTranslation();
  const [phase, setPhase] = useState<OwnPhase>("idle");
  const [result, setResult] = useState<ShadowResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [mineUrl, setMineUrl] = useState<string | null>(null);
  const [playingMine, setPlayingMine] = useState(false);
  const [best, setBest] = useState<Map<number, SegmentBest>>(() => peekBest(itemId) ?? new Map());
  const gen = useRef(0);
  const inflight = useRef<AbortController | null>(null);
  const audio = useRef<HTMLAudioElement | null>(null);
  const urlRef = useRef<string | null>(null);
  const mounted = useRef(true);
  const segRef = useRef(segment);
  segRef.current = segment;
  const pauseRef = useRef(pauseMedia);
  pauseRef.current = pauseMedia;
  const tRef = useRef(t);
  tRef.current = t;

  // 稳定的同一个函数:claimAudio / releaseAudio 按引用比较
  const stopMine = useCallback(function stop() {
    audio.current?.pause();
    releaseAudio(stop);
    if (mounted.current) setPlayingMine(false);
  }, []);

  const setMine = useCallback((url: string | null) => {
    if (urlRef.current) URL.revokeObjectURL(urlRef.current);
    urlRef.current = url;
    if (mounted.current) setMineUrl(url);
  }, []);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      gen.current += 1;
      inflight.current?.abort();
      audio.current?.pause();
      releaseAudio(stopMine);
      if (urlRef.current) URL.revokeObjectURL(urlRef.current);
      urlRef.current = null; // 麦克风由 useRecorder 自己的卸载清理释放
    };
  }, [stopMine]);

  useEffect(() => {
    let alive = true;
    loadBest(api, itemId)
      .then((map) => {
        if (alive) setBest(map);
      })
      .catch((): void => undefined); // 成绩只用于展示:取不到就不显示「最好成绩」
    return () => {
      alive = false;
    };
  }, [api, itemId]);

  const submit = useCallback(async (recording: RecordingResult, target: ShadowTarget, g: number) => {
    if (g !== gen.current) return;
    if (recording.noSpeech) {
      // R-SH13:没有前景语音,不花上游的钱
      setError(tRef.current("web.library.shadow.noSpeech"));
      setPhase("error");
      return;
    }
    const controller = new AbortController();
    inflight.current = controller;
    setError(null);
    setPhase("assessing");
    try {
      const { wav } = await toAssessmentWav(recording.blob);
      if (g !== gen.current) return;
      setMine(URL.createObjectURL(wav));
      const res = await assessPronunciation(api, {
        wav, reference: target.text, language: "en-US", save: true, source: "library", signal: controller.signal,
      });
      if (g !== gen.current) return;
      if (!res.assessmentId) throw new ApiError(500, "Could not save the recording");
      const scores: AssessmentScores = {
        pronunciationScore: res.pronunciationScore,
        accuracyScore: res.accuracyScore,
        fluencyScore: res.fluencyScore,
        completenessScore: res.completenessScore,
      };
      let attemptSaved = true;
      try {
        await recordAttempt(api, itemId, { segIdx: target.idx, assessmentId: res.assessmentId });
      } catch {
        attemptSaved = false; // R-SH14:不挡住结果,不弹 toast,不记日志
      }
      if (attemptSaved) {
        // 这是真实的一次练习:即使换句 / 卸载了,缓存也要记上
        const next = noteAttempt(itemId, target.idx, scores.pronunciationScore);
        if (mounted.current) setBest(next);
      }
      if (g !== gen.current) return;
      setResult({
        segIdx: target.idx, scores, words: briefWords(res.detailResult?.words), assessmentId: res.assessmentId, attemptSaved,
      });
      setPhase("done");
    } catch (err) {
      if (g !== gen.current) return;
      setError(describeAudioError(tRef.current, err, PRACTICE_SERVER_ERRORS));
      setPhase("error");
    } finally {
      if (inflight.current === controller) inflight.current = null;
    }
  }, [api, itemId, setMine]);

  const recorder = useRecorder({
    starter,
    maxDurationMs: SHADOW_MAX_MS,
    onAutoStop: (rec) => {
      const target = segRef.current;
      // R-SH13:只有到达上限才自动评测;切后台 / 麦克风断开的录音丢弃
      if (rec.stoppedBy === "max_duration" && target) void submit(rec, target, gen.current);
    },
  });
  const cancelRecording = recorder.cancel;

  const segKey = segment ? `${segment.idx}\u0000${segment.text}` : "";
  useEffect(() => {
    gen.current += 1;
    inflight.current?.abort();
    inflight.current = null;
    cancelRecording();
    stopMine();
    setMine(null);
    setResult(null);
    setError(null);
    setPhase("idle");
  }, [segKey, cancelRecording, stopMine, setMine]);

  const recorderState = recorder.state;
  const toggle = useCallback(async () => {
    if (recorderState === "recording") {
      const target = segRef.current;
      const g = gen.current;
      const rec = await recorder.stop();
      if (rec && target) await submit(rec, target, g);
      return;
    }
    if (recorderState !== "idle" || phase === "assessing" || !segRef.current) return;
    // R-SH12:以下都是同步动作,getUserMedia 仍在这次点按的手势里
    stopMine();
    pauseRef.current();
    setError(null);
    setResult(null);
    setPhase("idle");
    await recorder.start();
  }, [recorderState, phase, recorder, stopMine, submit]);

  const playMine = useCallback(() => {
    const url = urlRef.current;
    if (!url || recorderState !== "idle") return;
    if (playingMine) {
      stopMine();
      return;
    }
    pauseRef.current();
    const el = audio.current ?? new Audio();
    audio.current = el;
    el.onended = () => stopMine();
    el.src = url;
    claimAudio(stopMine);
    setPlayingMine(true);
    try {
      void Promise.resolve(el.play()).catch(() => stopMine());
    } catch {
      stopMine();
    }
  }, [recorderState, playingMine, stopMine]);

  const recorderError = recorder.error ? describeAudioError(t, recorder.error) : null;
  const shownPhase: ShadowPhase =
    recorderState === "starting" ? "starting"
      : recorderState === "recording" ? "recording"
        : recorderError && phase === "idle" ? "error"
          : phase;
  return {
    phase: shownPhase,
    error: error ?? recorderError,
    result,
    best: segment ? best.get(segment.idx) ?? null : null,
    elapsedMs: recorder.elapsedMs,
    canPlayMine: mineUrl !== null,
    playingMine,
    toggle,
    playMine,
    stopMine,
  };
}
