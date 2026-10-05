import { useCallback, useEffect, useRef, useState } from "react";
import type { TFunction } from "i18next";
import type { ApiClient } from "~/api/client";
import { translateServerError } from "~/api/error-messages";
import { encodeWavPcm16 } from "~/audio/wav";
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

export function useTtsPlayer(api: ApiClient, { cache = sharedTtsCache, createAudio = () => new Audio(), onError, onNothingToRead }: TtsPlayerOptions = {}) {
  const [states, setStates] = useState<Record<string, TtsState>>({});
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const currentRef = useRef<string | null>(null);
  const controllerRef = useRef<AbortController | null>(null);
  const mountedRef = useRef(true);
  const onErrorRef = useRef(onError);
  onErrorRef.current = onError;
  const onNothingRef = useRef(onNothingToRead);
  onNothingRef.current = onNothingToRead;
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

  const play = useCallback(async (messageKey: string, text: string, model: string, voice: string): Promise<void> => {
    if (currentRef.current === messageKey) return stop();
    const input = speakableText(text);
    if (!input) {
      onNothingRef.current?.();
      return;
    }
    stop();
    claimAudio(stop); // 全应用同一时刻只播一段:让录音回放停下
    const controller = new AbortController();
    controllerRef.current = controller;
    currentRef.current = messageKey;
    setState(messageKey, "loading");
    const element = (audioRef.current ??= createAudio());
    primeAudioElement(element);
    const fail = (err: unknown) => {
      currentRef.current = null;
      controllerRef.current = null;
      element.onerror = null;
      releaseAudio(stop);
      setState(messageKey, "error");
      onErrorRef.current?.(err);
    };
    const stale = () => controller.signal.aborted || currentRef.current !== messageKey;
    try {
      const key = ttsKey(model, voice, input);
      const url = cache.get(key) ?? cache.set(key, await synthesizeSpeech(api, { input, model, voice }, controller.signal));
      if (stale()) return;
      element.src = url;
      element.onended = () => {
        if (currentRef.current === messageKey) {
          currentRef.current = null;
          controllerRef.current = null;
          releaseAudio(stop);
          setState(messageKey, "idle");
        }
      };
      element.onerror = () => {
        if (currentRef.current !== messageKey) return;
        fail(new TtsPlaybackError());
      };
      setState(messageKey, "playing");
      await element.play().catch((err: unknown) => { throw new TtsPlaybackError(err); });
    } catch (err) {
      if (stale()) return; // 被新的播放/停止/卸载中止,不算错误
      fail(err);
    }
  }, [api, cache, stop]);

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
    };
  }, [stop]);
  return { states, play, stop };
}
