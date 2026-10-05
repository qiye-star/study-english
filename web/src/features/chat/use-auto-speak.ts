import { useCallback, useEffect, useRef, useState } from "react";
import { speakableText } from "./tts";
import type { UiMessage } from "./ui-message";
import { TtsPlaybackError } from "./use-tts-player";

export type AutoSpeakSkip = "disabled" | "not-done" | "stale" | "already-read" | "busy" | "hidden" | "no-voice" | "empty";

export interface AutoSpeakCheck {
  enabled: boolean;
  status: UiMessage["status"];
  stale: boolean;
  alreadyRead: boolean;
  voiceIdle: boolean;
  hidden: boolean;
  hasVoice: boolean;
  text: string;
}

/** R4:按固定顺序判断,第一条命中即跳过。 */
export function autoSpeakDecision(c: AutoSpeakCheck): "speak" | AutoSpeakSkip {
  if (!c.enabled) return "disabled";
  if (c.status !== "done") return "not-done";
  if (c.stale) return "stale";
  if (c.alreadyRead) return "already-read";
  if (!c.voiceIdle) return "busy";
  if (c.hidden) return "hidden";
  if (!c.hasVoice) return "no-voice";
  if (!speakableText(c.text)) return "empty";
  return "speak";
}

/** 浏览器自动播放策略拦截(iOS/Safari 脱离点击的 play()):降级为"点此朗读"(R6)。 */
export function isAutoplayBlocked(err: unknown): boolean {
  const cause = err instanceof TtsPlaybackError ? err.cause : err;
  return !!cause && typeof cause === "object" && (cause as { name?: unknown }).name === "NotAllowedError";
}

export interface UseAutoSpeakOptions {
  isEnabled(): boolean;
  /** 没有在录音/转写 */
  voiceIdle(): boolean;
  hasVoice(): boolean;
  /** 同步解锁播放器(useTtsPlayer.prime) */
  prime(): void;
  stop(): void;
  speak(key: string, text: string, onError: (err: unknown) => void): Promise<void>;
  /** 非"被拦截"的失败;每个会话最多调用一次 */
  onError(err: unknown): void;
}

/**
 * 自动朗读的决策与编排。本 hook 不碰 <audio>,只调用传入的 prime/stop/speak。
 *
 * 契约(共享自动播放元素):prime/stop/speak 必须来自同一个 useTtsPlayer 实例,且该实例是
 * 当前唯一以 sharedAutoplayAudio() 为 createAudio 的已挂载播放器。另一个使用同一元素的
 * useTtsPlayer 调用 stop()/卸载时会暂停该元素并清掉本实例的 onended/onerror,
 * 导致朗读静默中断、状态停在 playing。场景面板(解锁方)必须在会话页播放器挂载前卸载。
 *
 * 调用方职责:send() 的点击里先 prime() 再 begin(botKey);回复结束后 complete();
 * 切换会话时 player.stop() + reset();开始录音时 player.stop()(reset/unmount 不替调用方停止播放)。
 * 选项在每次调用时读取(isEnabled 等是函数),回调引用全部稳定。
 */
export function useAutoSpeak(options: UseAutoSpeakOptions) {
  const opts = useRef(options);
  opts.current = options;
  const latestRef = useRef<string | null>(null); // 最近一次 send() 的助手气泡 key
  const readRef = useRef(new Set<string>());
  const reportedRef = useRef(false);
  const hintShownRef = useRef(false);
  const genRef = useRef(0); // reset/卸载后递增:之前的播放失败不再处理
  const mountedRef = useRef(true);
  const [blocked, setBlocked] = useState<{ key: string; text: string } | null>(null);
  const blockedRef = useRef(blocked);
  blockedRef.current = blocked;

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      genRef.current += 1;
      latestRef.current = null;
    };
  }, []);

  const failureHandler = useCallback((key: string, text: string) => {
    const gen = genRef.current;
    return (err: unknown) => {
      if (gen !== genRef.current || !mountedRef.current) return;
      if (isAutoplayBlocked(err)) {
        if (hintShownRef.current) return;
        hintShownRef.current = true;
        setBlocked({ key, text });
        return;
      }
      if (reportedRef.current) return;
      reportedRef.current = true;
      opts.current.onError(err);
    };
  }, []);

  const startSpeaking = useCallback((key: string, text: string) => {
    const onError = failureHandler(key, text);
    // useTtsPlayer.play 自己吞掉错误;这里兜底,避免未处理的 rejection
    opts.current.speak(key, text, onError).catch(onError);
  }, [failureHandler]);

  const run = useCallback((key: string, text: string, status: UiMessage["status"], stale: boolean) => {
    const o = opts.current;
    const decision = autoSpeakDecision({
      enabled: o.isEnabled(), status, stale: stale || !mountedRef.current, alreadyRead: readRef.current.has(key), voiceIdle: o.voiceIdle(),
      hidden: typeof document !== "undefined" && document.hidden, hasVoice: o.hasVoice(), text,
    });
    if (decision !== "speak") return decision;
    readRef.current.add(key); // 先记为已读:StrictMode/重复调用不会读两次
    startSpeaking(key, text);
    return decision;
  }, [startSpeaking]);

  /** R5:在用户点击的同步阶段、任何 await 之前调用 */
  const prime = useCallback(() => {
    const o = opts.current;
    if (!o.isEnabled()) return;
    o.stop();
    o.prime();
  }, []);

  const begin = useCallback((botKey: string) => { latestRef.current = botKey; }, []);

  const complete = useCallback((botKey: string, text: string, status: UiMessage["status"]) =>
    run(botKey, text, status, latestRef.current !== botKey), [run]);

  /** R10:场景开场白;用户已经发过消息就不再读 */
  const speakOpening = useCallback((key: string, text: string) => run(key, text, "done", latestRef.current !== null), [run]);

  /** 切换会话:之前的一切过期,提示与报错标记重置(不停止播放,由调用方 player.stop()) */
  const reset = useCallback(() => {
    genRef.current += 1;
    latestRef.current = null;
    readRef.current = new Set();
    reportedRef.current = false;
    hintShownRef.current = false;
    if (mountedRef.current) setBlocked(null);
  }, []);

  /** "点此朗读":在点击里调用 speak(useTtsPlayer.play 会同步解锁) */
  const tapToRead = useCallback(() => {
    const target = blockedRef.current;
    if (!target || !mountedRef.current) return;
    blockedRef.current = null; // 同一渲染内连点两次只读一次
    setBlocked(null);
    startSpeaking(target.key, target.text);
  }, [startSpeaking]);

  const dismissBlocked = useCallback(() => {
    if (mountedRef.current) setBlocked(null);
  }, []);

  return { prime, begin, complete, speakOpening, reset, blocked, tapToRead, dismissBlocked };
}
