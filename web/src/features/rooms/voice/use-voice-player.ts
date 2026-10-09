import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { translateServerError } from "~/api/error-messages";
import { useAuth } from "~/auth/auth-context";
import { claimAudio, releaseAudio } from "~/audio/audio-focus";
import { primeAudioElement } from "~/features/chat";
import { applyPlaybackRate, trackMediaElement } from "~/lib/playback-rate";
import { ROOMS_SERVER_ERRORS } from "../rooms-api";
import { fetchVoiceAudio, ROOM_VOICE_SERVER_ERRORS } from "./voice-api";

export type VoicePlayerState = "idle" | "loading" | "playing" | "error";

const ERRORS = { ...ROOMS_SERVER_ERRORS, ...ROOM_VOICE_SERVER_ERRORS };

/**
 * 房间语音播放(spec 2026-10-10 §4.3):点击时在手势内 primeAudioElement(iOS 解锁),再带鉴权取音频 → blob URL → 播放。
 * 不预取、永不自动播放;全应用同一时刻只播一段(claimAudio);语速跟随全局播放速度(trackMediaElement);卸载回收 blob URL。
 * 音频是 MP3(iOS Safari / Android Chrome 都能直接播)。410 → "音频已被管理员清理"。positionMs 是播放进度(展示用)。
 */
export function useVoicePlayer(roomId: string, messageId: string): { state: VoicePlayerState; error: string | null; positionMs: number; toggle(): void } {
  const { api } = useAuth();
  const { t } = useTranslation();
  const tRef = useRef(t);
  tRef.current = t;
  const [state, setState] = useState<VoicePlayerState>("idle");
  const [error, setError] = useState<string | null>(null);
  const [positionMs, setPositionMs] = useState(0);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const untrackRef = useRef<(() => void) | null>(null);
  const urlRef = useRef<string | null>(null);
  const mounted = useRef(true);
  const genRef = useRef(0); // 每次停止递增,让过期的异步结果失效
  const controllerRef = useRef<AbortController | null>(null);

  const element = () => {
    if (!audioRef.current) {
      audioRef.current = new Audio();
      untrackRef.current = trackMediaElement(audioRef.current);
    }
    return audioRef.current;
  };

  const halt = useCallback(() => {
    genRef.current++;
    controllerRef.current?.abort();
    controllerRef.current = null;
    const el = audioRef.current;
    if (el) {
      el.pause();
      el.onended = null;
      el.onerror = null;
      el.ontimeupdate = null;
    }
    if (mounted.current) {
      setState((s) => (s === "error" ? s : "idle"));
      setPositionMs(0);
    }
  }, []);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      halt();
      releaseAudio(halt);
      untrackRef.current?.();
      untrackRef.current = null;
      if (urlRef.current) URL.revokeObjectURL(urlRef.current);
      urlRef.current = null;
      audioRef.current = null;
    };
  }, [halt]);

  const fail = (message: string) => {
    if (!mounted.current) return;
    setError(message);
    setState("error");
  };

  const playFrom = (el: HTMLAudioElement, src: string, gen: number) => {
    el.src = src;
    applyPlaybackRate(el);
    el.onended = () => {
      if (gen !== genRef.current) return;
      releaseAudio(halt);
      if (mounted.current) {
        setState("idle");
        setPositionMs(0);
      }
    };
    el.ontimeupdate = () => { if (gen === genRef.current && mounted.current) setPositionMs(Math.round(el.currentTime * 1000)); };
    el.onerror = () => { if (gen === genRef.current) fail(tRef.current("web.rooms.voice.playFailed")); };
    setState("playing");
    Promise.resolve(el.play()).catch(() => { if (gen === genRef.current) fail(tRef.current("web.rooms.voice.playFailed")); });
  };

  const toggle = () => {
    if (state === "playing" || state === "loading") {
      halt();
      releaseAudio(halt);
      return;
    }
    const el = element();
    setError(null);
    claimAudio(halt); // 先让别处正在播的停下
    const gen = ++genRef.current;
    if (urlRef.current) return playFrom(el, urlRef.current, gen);
    primeAudioElement(el); // 必须在点击的同步阶段(任何 await 之前)
    setState("loading");
    const controller = new AbortController();
    controllerRef.current = controller;
    fetchVoiceAudio(api, roomId, messageId, controller.signal).then(
      (blob) => {
        if (!mounted.current || gen !== genRef.current) return;
        controllerRef.current = null;
        urlRef.current = URL.createObjectURL(blob);
        playFrom(el, urlRef.current, gen);
      },
      (err) => {
        if (gen !== genRef.current) return;
        controllerRef.current = null;
        releaseAudio(halt);
        fail(translateServerError(tRef.current, err, ERRORS));
      },
    );
  };

  return { state, error, positionMs, toggle };
}
