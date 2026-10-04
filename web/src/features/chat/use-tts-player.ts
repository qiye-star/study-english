import { useCallback, useEffect, useRef, useState } from "react";
import type { ApiClient } from "~/api/client";
import { encodeWavPcm16 } from "~/audio/wav";
import { synthesizeSpeech } from "./speech-api";
import { TtsCache, sharedTtsCache, speakableText, ttsKey } from "./tts";

export type TtsState = "idle" | "loading" | "playing" | "error";

let silentUrl: string | null = null;
function silentWavUrl(): string {
  silentUrl ??= URL.createObjectURL(new Blob([encodeWavPcm16(new Float32Array(160), 16000)], { type: "audio/wav" }));
  return silentUrl;
}

export interface TtsPlayerOptions {
  cache?: TtsCache;
  createAudio?: () => HTMLAudioElement;
  /** 朗读失败(非主动中止)时调用,用于展示翻译后的错误。 */
  onError?: (err: unknown) => void;
}

export function useTtsPlayer(api: ApiClient, { cache = sharedTtsCache, createAudio = () => new Audio(), onError }: TtsPlayerOptions = {}) {
  const [states, setStates] = useState<Record<string, TtsState>>({});
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const currentRef = useRef<string | null>(null);
  const controllerRef = useRef<AbortController | null>(null);
  const mountedRef = useRef(true);
  const onErrorRef = useRef(onError);
  onErrorRef.current = onError;
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
    }
    if (currentRef.current) setState(currentRef.current, "idle");
    currentRef.current = null;
  }, []);

  const play = useCallback(async (messageKey: string, text: string, model: string, voice: string): Promise<void> => {
    if (currentRef.current === messageKey) return stop();
    stop();
    const controller = new AbortController();
    controllerRef.current = controller;
    currentRef.current = messageKey;
    setState(messageKey, "loading");
    const element = (audioRef.current ??= createAudio());
    // iOS:在点击的同步阶段先播放一段静音,解锁这个 <audio>,之后异步拿到数据再播放才不会被拦截。
    try {
      element.src = silentWavUrl();
      void element.play()?.catch((): void => undefined);
    } catch {
      /* jsdom 等环境没有 createObjectURL */
    }
    const input = speakableText(text);
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
          setState(messageKey, "idle");
        }
      };
      setState(messageKey, "playing");
      await element.play();
    } catch (err) {
      if (stale()) return; // 被新的播放/停止/卸载中止,不算错误
      currentRef.current = null;
      controllerRef.current = null;
      setState(messageKey, "error");
      onErrorRef.current?.(err);
    }
  }, [api, cache, stop]);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      controllerRef.current?.abort();
      controllerRef.current = null;
      currentRef.current = null;
      const element = audioRef.current;
      if (element) {
        element.pause();
        element.onended = null;
      }
    };
  }, []);
  return { states, play, stop };
}
