import { useCallback, useEffect, useRef, useState } from "react";
import type { TFunction } from "i18next";
import type { ApiClient } from "~/api/client";
import { translateServerError } from "~/api/error-messages";
import { encodeWavPcm16 } from "~/audio/wav";
import { markLatency } from "~/lib/latency";
import { applyPlaybackRate, trackMediaElement } from "~/lib/playback-rate";
import { CHAT_SERVER_ERRORS } from "./chat-api";
import { claimAudio, releaseAudio } from "~/audio/audio-focus";
import { synthesizeSpeech } from "./speech-api";
import { TtsCache, sharedTtsCache, speakableText, ttsKey } from "./tts";

export type TtsState = "idle" | "loading" | "playing" | "error";

/** 按句朗读的队列(R8):push 一句就排一句,end() 表示不会再有新句子。 */
export interface TtsQueue {
  push(sentence: string): void;
  end(): void;
}

/** 正在播放的句子之外,最多提前合成的句数(R8) */
export const QUEUE_PREFETCH = 2;

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
    markLatency("tts_request");
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
      markLatency("first_audio");
    } catch (err) {
      if (stale()) return; // 被新的播放/停止/卸载中止,不算错误
      fail(err);
    }
  }, [api, cache, stop, element]);

  /**
   * R8:按句串行播放。调用方已在点击里解锁共享元素(R5),这里不 prime。
   * stop()/prime()/新的 play()/playQueue()/卸载/其他播放方 claimAudio 都会让这个队列失效(不报错)。
   */
  const playQueue = useCallback((messageKey: string, model: string, voice: string, opts: TtsPlayOptions = {}): TtsQueue => {
    stop();
    claimAudio(stop); // 全应用同一时刻只播一段
    const controller = new AbortController();
    controllerRef.current = controller;
    currentRef.current = messageKey;
    setState(messageKey, "loading");
    const audio = element();
    const waiting: string[] = [];
    const fetched: Array<Promise<string>> = [];
    let next = 0; // 下一句要播放的 fetched 下标
    let ended = false;
    let busy = false; // 正在等待/播放 fetched[next - 1]
    let first = true;
    const stale = () => controller.signal.aborted || currentRef.current !== messageKey;
    /** 正在播放时最多 QUEUE_PREFETCH 句在途;两句之间(未播放)再多一句,即将播放的那句 */
    const prefetch = () => {
      while (!stale() && waiting.length && fetched.length - next < QUEUE_PREFETCH + (busy ? 0 : 1)) {
        const input = waiting.shift()!;
        const key = ttsKey(model, voice, input);
        const hit = cache.get(key);
        if (!fetched.length) markLatency("tts_request");
        const url: Promise<string> = hit !== undefined ? Promise.resolve(hit) : synthesizeSpeech(api, { input, model, voice }, controller.signal).then((blob) => cache.set(key, blob));
        url.catch((): void => undefined); // 失败在轮到它时处理
        fetched.push(url);
      }
    };
    const finish = () => {
      currentRef.current = null;
      controllerRef.current = null;
      audio.onerror = null;
      audio.onended = null;
      releaseAudio(stop);
    };
    const fail = (err: unknown) => {
      controller.abort(); // 停掉剩余句子的合成
      finish();
      setState(messageKey, "error");
      (opts.onError ?? onErrorRef.current)?.(err);
    };
    const pump = async (): Promise<void> => {
      if (busy || stale()) return;
      prefetch();
      if (next >= fetched.length) {
        if (ended) {
          finish();
          setState(messageKey, "idle");
        }
        return;
      }
      busy = true;
      try {
        const url = await fetched[next++];
        prefetch();
        if (stale()) return;
        audio.src = url;
        applyPlaybackRate(audio); // 换 src 后每句都要再设一次(R8 语速)
        await new Promise<void>((resolve, reject) => {
          audio.onended = () => resolve();
          audio.onerror = () => reject(new TtsPlaybackError());
          setState(messageKey, "playing");
          audio.play().then(() => {
            if (first && !stale()) {
              first = false;
              markLatency("first_audio");
            }
          }, (err: unknown) => reject(new TtsPlaybackError(err)));
        });
        busy = false;
        void pump();
      } catch (err) {
        busy = false;
        if (stale()) return; // 被停止/新的播放/卸载中止,不算错误
        fail(err);
      }
    };
    return {
      push(sentence) {
        if (ended || stale()) return;
        const input = speakableText(sentence);
        if (!input) return;
        waiting.push(input);
        prefetch();
        void pump();
      },
      end() {
        if (ended) return;
        ended = true;
        void pump();
      },
    };
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
  return { states, play, playQueue, stop, prime };
}
