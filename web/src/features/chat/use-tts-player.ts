import { useCallback, useEffect, useRef, useState } from "react";
import type { TFunction } from "i18next";
import type { ApiClient } from "~/api/client";
import { translateServerError } from "~/api/error-messages";
import { encodeWavPcm16 } from "~/audio/wav";
import { applyPlaybackRate, trackMediaElement } from "~/lib/playback-rate";
import { CHAT_SERVER_ERRORS } from "./chat-api";
import { claimAudio, releaseAudio } from "./audio-focus";
import { synthesizeSpeech } from "./speech-api";
import { TtsCache, sharedTtsCache, speakableText, ttsKey } from "./tts";

export type TtsState = "idle" | "loading" | "playing" | "error";

let silentUrl: string | null = null;
function silentWavUrl(): string {
  silentUrl ??= URL.createObjectURL(new Blob([encodeWavPcm16(new Float32Array(160), 16000)], { type: "audio/wav" }));
  return silentUrl;
}

/** iOS:在点击的同步阶段播放一段静音,解锁这个 <audio>;之后异步拿到数据再播放才不会被拦截。 */
export function primeAudioElement(element: HTMLAudioElement): void {
  try {
    element.src = silentWavUrl();
    void element.play()?.catch((): void => undefined);
  } catch {
    /* jsdom 等环境没有 createObjectURL */
  }
}

let sharedAudio: HTMLAudioElement | null = null;
/**
 * 对话页朗读(含自动朗读)与场景面板共用的 <audio>(R5):在场景面板的点击里解锁,
 * 跳到会话页后用同一个元素播放开场白;页面切换不换元素,iOS 的解锁才不会丢。
 */
export function sharedAutoplayAudio(): HTMLAudioElement {
  sharedAudio ??= new Audio();
  return sharedAudio;
}

/** 本地播放失败(被浏览器拦截、解码错误),区别于服务端合成失败。 */
export class TtsPlaybackError extends Error {
  constructor(readonly cause?: unknown) {
    super("TTS playback failed");
  }
}

export function ttsErrorMessage(t: TFunction, err: unknown): string {
  return err instanceof TtsPlaybackError ? t("web.chat.speakFailed") : translateServerError(t, err, CHAT_SERVER_ERRORS);
}

export interface TtsPlayerOptions {
  cache?: TtsCache;
  createAudio?: () => HTMLAudioElement;
  /** 朗读失败(非主动中止)时调用,用于展示翻译后的错误。 */
  onError?: (err: unknown) => void;
  /** 文本里没有可朗读的内容(例如只有代码块)时调用;此时不发请求。 */
  onNothingToRead?: () => void;
}

export interface TtsPlayOptions {
  /** 只对这一次播放生效,替代 options.onError(自动朗读据此做"最多提示一次"与"被拦截"判断) */
  onError?: (err: unknown) => void;
  /** 没有可朗读的内容时静默,不调用 onNothingToRead(自动朗读用) */
  quietIfEmpty?: boolean;
}

export function useTtsPlayer(api: ApiClient, { cache = sharedTtsCache, createAudio, onError, onNothingToRead }: TtsPlayerOptions = {}) {
  const [states, setStates] = useState<Record<string, TtsState>>({});
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const currentRef = useRef<string | null>(null);
  const controllerRef = useRef<AbortController | null>(null);
  const mountedRef = useRef(true);
  const onErrorRef = useRef(onError);
  onErrorRef.current = onError;
  const onNothingRef = useRef(onNothingToRead);
  onNothingRef.current = onNothingToRead;
  const createRef = useRef(createAudio);
  createRef.current = createAudio;
  const untrackRef = useRef<(() => void) | null>(null);
  /** 惰性创建播放器元素,并登记到全局语速(R8) */
  const element = useCallback((): HTMLAudioElement => {
    if (!audioRef.current) {
      audioRef.current = createRef.current?.() ?? new Audio();
      untrackRef.current = trackMediaElement(audioRef.current);
    }
    return audioRef.current;
  }, []);

  const setState = (key: string, state: TtsState) => {
    if (mountedRef.current) setStates((prev) => ({ ...prev, [key]: state }));
  };

  const stop = useCallback(() => {
    controllerRef.current?.abort();
    controllerRef.current = null;
    const element = audioRef.current;
    if (element) {
      element.pause();
      element.onended = null;
      element.onerror = null;
    }
    if (currentRef.current) setState(currentRef.current, "idle");
    currentRef.current = null;
    releaseAudio(stop);
  }, []);

  /** iOS:必须在点击的同步阶段、任何 await 之前调用 */
  const prime = useCallback(() => {
    stop(); // 用户的点击打断正在进行的朗读,状态才确定(并让旧的 onended 不再触发)
    primeAudioElement(element());
  }, [stop, element]);

  const play = useCallback(async (messageKey: string, text: string, model: string, voice: string, opts: TtsPlayOptions = {}): Promise<void> => {
    if (currentRef.current === messageKey) return stop();
    const input = speakableText(text);
    if (!input) {
      if (!opts.quietIfEmpty) onNothingRef.current?.();
      return;
    }
    stop();
    claimAudio(stop); // 全应用同一时刻只播一段:让录音回放停下
    const controller = new AbortController();
    controllerRef.current = controller;
    currentRef.current = messageKey;
    setState(messageKey, "loading");
    const audio = element();
    primeAudioElement(audio);
    const fail = (err: unknown) => {
      currentRef.current = null;
      controllerRef.current = null;
      audio.onerror = null;
      releaseAudio(stop);
      setState(messageKey, "error");
      (opts.onError ?? onErrorRef.current)?.(err);
    };
    const stale = () => controller.signal.aborted || currentRef.current !== messageKey;
    try {
      const key = ttsKey(model, voice, input);
      const url = cache.get(key) ?? cache.set(key, await synthesizeSpeech(api, { input, model, voice }, controller.signal));
      if (stale()) return;
      audio.src = url;
      applyPlaybackRate(audio); // 换 src 后再设一次(R8)
      audio.onended = () => {
        if (currentRef.current === messageKey) {
          currentRef.current = null;
          controllerRef.current = null;
          releaseAudio(stop);
          setState(messageKey, "idle");
        }
      };
      audio.onerror = () => {
        if (currentRef.current !== messageKey) return;
        fail(new TtsPlaybackError());
      };
      setState(messageKey, "playing");
      await audio.play().catch((err: unknown) => { throw new TtsPlaybackError(err); });
    } catch (err) {
      if (stale()) return; // 被新的播放/停止/卸载中止,不算错误
      fail(err);
    }
  }, [api, cache, stop, element]);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      controllerRef.current?.abort();
      controllerRef.current = null;
      currentRef.current = null;
      releaseAudio(stop); // 不留下指向已卸载播放器的过期闭包
      const element = audioRef.current;
      if (element) {
        element.pause();
        element.onended = null;
        element.onerror = null;
      }
      untrackRef.current?.();
      untrackRef.current = null;
      audioRef.current = null; // StrictMode 重新挂载时重新创建并登记
    };
  }, [stop]);
  return { states, play, stop, prime };
}
