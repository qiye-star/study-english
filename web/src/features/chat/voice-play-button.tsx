import { LoaderIcon, PauseIcon, PlayIcon } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { translateServerError } from "~/api/error-messages";
import { useAuth } from "~/auth/auth-context";
import { PRACTICE_SERVER_ERRORS, getAssessmentAudio } from "~/features/practice/assessment-api";
import { applyPlaybackRate, trackMediaElement } from "~/lib/playback-rate";
import { claimAudio, releaseAudio } from "./audio-focus";
import { primeAudioElement } from "./use-tts-player";

export function formatDuration(ms: number): string {
  const seconds = Math.max(0, Math.round(ms / 1000));
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}

type PlayState = "idle" | "loading" | "playing" | "error";

/**
 * 本次会话录的语音直接播放本地 blob;刷新后的语音消息走带鉴权的评测音频接口 → blob URL。
 * 只在用户点击播放时才请求(不预取),卸载或换音频时回收 blob URL;全应用同一时刻只播一段。
 */
export function VoicePlayButton({ audioUrl, assessmentId, disabled }: { audioUrl?: string; assessmentId?: string | null; disabled?: boolean }) {
  const { api } = useAuth();
  const { t } = useTranslation();
  const tRef = useRef(t);
  tRef.current = t;
  const [state, setState] = useState<PlayState>("idle");
  const [errorText, setErrorText] = useState<string | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const fetchedRef = useRef<string | null>(null);
  const mounted = useRef(true);
  const genRef = useRef(0); // 每次停止/换源递增,让过期的异步结果失效
  const untrackRef = useRef<(() => void) | null>(null);
  const getElement = () => {
    if (!audioRef.current) {
      audioRef.current = new Audio();
      untrackRef.current = trackMediaElement(audioRef.current); // R8:语音气泡回放同样跟随语速
    }
    return audioRef.current;
  };

  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);

  const halt = useCallback(() => {
    genRef.current++;
    const element = audioRef.current;
    if (element) {
      element.pause();
      element.onended = null;
      element.onerror = null;
    }
    // 别处抢占音频触发的 halt 不应清掉本按钮已显示的错误提示
    if (mounted.current) setState((s) => (s === "error" ? s : "idle"));
  }, []);

  // 换音频或卸载:停止并回收 blob URL
  useEffect(() => () => {
    halt();
    releaseAudio(halt);
    if (fetchedRef.current) URL.revokeObjectURL(fetchedRef.current);
    fetchedRef.current = null;
    if (mounted.current) {
      setState("idle");
      setErrorText(null);
    }
  }, [assessmentId, audioUrl, halt]);

  useEffect(() => () => {
    untrackRef.current?.();
    untrackRef.current = null;
    audioRef.current = null;
  }, []);

  const fail = (message: string) => {
    if (!mounted.current) return;
    setErrorText(message);
    setState("error");
  };

  const playFrom = (element: HTMLAudioElement, src: string, gen: number) => {
    element.src = src;
    applyPlaybackRate(element);
    element.onended = () => {
      if (gen !== genRef.current) return;
      releaseAudio(halt);
      if (mounted.current) setState("idle");
    };
    element.onerror = () => { if (gen === genRef.current) fail(tRef.current("web.chat.voice.playFailed")); };
    setState("playing");
    element.play().catch(() => { if (gen === genRef.current) fail(tRef.current("web.chat.voice.playFailed")); });
  };

  const toggle = () => {
    const element = getElement();
    if (state === "playing") {
      halt();
      releaseAudio(halt);
      return;
    }
    setErrorText(null);
    claimAudio(halt); // 先让别处正在播的停下
    const gen = ++genRef.current;
    const src = audioUrl ?? fetchedRef.current;
    if (src) return playFrom(element, src, gen);
    if (!assessmentId) return;
    primeAudioElement(element); // 必须在点击的同步阶段
    setState("loading");
    getAssessmentAudio(api, assessmentId).then(
      (blob) => {
        if (!mounted.current || gen !== genRef.current) return;
        fetchedRef.current = URL.createObjectURL(blob);
        playFrom(element, fetchedRef.current, gen);
      },
      (err) => { if (gen === genRef.current) fail(translateServerError(tRef.current, err, PRACTICE_SERVER_ERRORS)); },
    );
  };

  const canPlay = !!audioUrl || !!assessmentId;
  return (
    <>
      <button type="button" data-testid="voice-play" data-state={state} disabled={disabled || !canPlay || state === "loading"}
        aria-label={state === "playing" ? t("web.chat.voice.pause") : t("web.chat.voice.play")}
        className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-full disabled:opacity-50"
        onClick={toggle}>
        {state === "loading" ? <LoaderIcon className="h-5 w-5 animate-spin" /> : state === "playing" ? <PauseIcon className="h-5 w-5" /> : <PlayIcon className="h-5 w-5" />}
      </button>
      {state === "error" && errorText && <span role="alert" className="text-xs">{errorText}</span>}
    </>
  );
}
