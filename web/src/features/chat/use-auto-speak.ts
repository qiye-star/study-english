import { useCallback, useEffect, useRef, useState } from "react";
import { abortLatencyTrace, markLatency } from "~/lib/latency";
import { createSentenceStream, splitForSpeech, type SentenceStream } from "./sentence-stream";
import { speakableText, stripMarkdown } from "./tts";
import type { UiMessage } from "./ui-message";
import { TtsPlaybackError, type TtsQueue } from "./use-tts-player";

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
  /** R8:按句流水线朗读(useTtsPlayer.playQueue);不提供时 progress() 是空操作 */
  speakQueue?: (key: string, onError: (err: unknown) => void) => TtsQueue;
}

const FENCE = "```";

interface Pipe {
  key: string;
  stream: SentenceStream;
  queue: TtsQueue | null;
  /** 这条回复不走流水线(含代码块、或第一句时判断为不读),交给 complete 按原规则判断 */
  off: boolean;
  /** 队列打开后出现的第一个代码块的位置:之前的文本按句读,之后的在 complete 时剥掉代码再读 */
  fence: number;
  /** 最新的全文:被拦截时"点此朗读"读整条回复 */
  text: string;
}

/**
 * 自动朗读的决策与编排。本 hook 不碰 <audio>,只调用传入的 prime/stop/speak。
 *
 * 契约(共享自动播放元素):prime/stop/speak/speakQueue 必须来自同一个 useTtsPlayer 实例(speakQueue = playQueue),且该实例是
 * 当前唯一以 sharedAutoplayAudio() 为 createAudio 的已挂载播放器。另一个使用同一元素的
 * useTtsPlayer 调用 stop()/卸载时会暂停该元素并清掉本实例的 onended/onerror,
 * 导致朗读静默中断、状态停在 playing。场景面板(解锁方)必须在会话页播放器挂载前卸载。
 *
 * 调用方职责:send() 的点击里先 prime() 再 begin(botKey);流式期间每次增量调用 progress(botKey, full)(R8);
 * 回复结束后 complete()(流被中止而不调用 complete 时,调用方须 player.stop(),否则队列停在等待下一句);
 * 切换会话时 player.stop() + reset();开始录音时 player.stop()(reset/unmount 不替调用方停止播放);
 * 关闭开关时 player.stop()(关闭后 prime() 不再打断播放)。"每个会话一次"的提示/报错以 reset() 为界。
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
      pipeRef.current = null;
    };
  }, []);

  const pipeRef = useRef<Pipe | null>(null);

  /** text 可以是函数:流水线朗读出错时取当时的全文 */
  const failureHandler = useCallback((key: string, text: string | (() => string)) => {
    const gen = genRef.current;
    return (err: unknown) => {
      if (gen !== genRef.current || !mountedRef.current) return;
      abortLatencyTrace(); // 朗读失败/被拦截:这一轮不会有 first_audio
      if (isAutoplayBlocked(err)) {
        if (hintShownRef.current) return;
        hintShownRef.current = true;
        setBlocked({ key, text: typeof text === "function" ? text() : text });
        return;
      }
      if (reportedRef.current) return;
      reportedRef.current = true;
      opts.current.onError(err);
    };
  }, []);

  const startSpeaking = useCallback((key: string, text: string) => {
    const onError = failureHandler(key, text);
    // useTtsPlayer.play 自己吞掉错误;这里兜底:同步抛出与 rejection 走同一条失败路径
    try {
      opts.current.speak(key, text, onError).catch(onError);
    } catch (err) {
      onError(err);
    }
  }, [failureHandler]);

  /**
   * final:这次判断是否是该回复的最终结果(done/error;streaming 不是)。
   * 最终结果无论读不读都"消耗"这个 key(§3.0:跳过就是跳过,不会在条件恢复后补读)。
   */
  const run = useCallback((key: string, text: string, status: UiMessage["status"], stale: boolean, final: boolean) => {
    const o = opts.current;
    const isStale = stale || !mountedRef.current;
    const decision = autoSpeakDecision({
      enabled: o.isEnabled(), status, stale: isStale, alreadyRead: readRef.current.has(key), voiceIdle: o.voiceIdle(),
      hidden: typeof document !== "undefined" && document.hidden, hasVoice: o.hasVoice(), text,
    });
    if (final && !isStale) readRef.current.add(key); // 先记为已处理:StrictMode/重复调用不会读两次
    if (decision === "speak") startSpeaking(key, text);
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

  /**
   * R8:回复流式进行中逐句朗读。第一句完成时按 R4 判断一次(status 视为 done;不是最终结果,不消耗 key);
   * "读"才开队列并把 key 记为已读,之后每完成一句 push 一句;"不读"则这条不走流水线,由 complete 按原规则判断。
   */
  const progress = useCallback((botKey: string, full: string) => {
    const o = opts.current;
    if (!o.speakQueue || latestRef.current !== botKey || !mountedRef.current) return;
    let pipe = pipeRef.current;
    if (!pipe || pipe.key !== botKey) pipe = pipeRef.current = { key: botKey, stream: createSentenceStream(), queue: null, off: false, fence: -1, text: full };
    if (pipe.off) return;
    pipe.text = full;
    if (!pipe.queue && full.includes(FENCE)) {
      pipe.off = true; // 代码块出现在第一句之前:整条按原路径(speakableText 会剥掉代码)
      return;
    }
    if (pipe.fence < 0) pipe.fence = full.indexOf(FENCE);
    // 末尾的反引号可能是代码块的开头:先不交给切句器(切句器的输入必须只增不减)
    const sentences = pipe.stream.push(pipe.fence < 0 ? full.replace(/`+$/, "") : full.slice(0, pipe.fence));
    if (!sentences.length) return;
    if (!pipe.queue) {
      const decision = autoSpeakDecision({
        enabled: o.isEnabled(), status: "done", stale: false, alreadyRead: readRef.current.has(botKey), voiceIdle: o.voiceIdle(),
        hidden: typeof document !== "undefined" && document.hidden, hasVoice: o.hasVoice(), text: full,
      });
      if (decision !== "speak") {
        pipe.off = true; // 留给 complete 按原规则判断(那时才消耗 key)
        return;
      }
      readRef.current.add(botKey);
      const current = pipe;
      pipe.queue = o.speakQueue(botKey, failureHandler(botKey, () => current.text));
    }
    for (const s of sentences) pipe.queue.push(s);
  }, [failureHandler]);

  /** 已开队列的回复结束:done → 推入剩余句子并 end();其他最终状态 → 立即停止(已读部分不补) */
  const finishPipe = useCallback((pipe: Pipe & { queue: TtsQueue }, text: string, status: UiMessage["status"]) => {
    if (status !== "done") {
      opts.current.stop();
      abortLatencyTrace();
      return "not-done" as const;
    }
    pipe.text = text;
    const head = pipe.fence < 0 ? text : text.slice(0, pipe.fence);
    const rest = [...pipe.stream.push(head), ...pipe.stream.flush()];
    if (pipe.fence >= 0) rest.push(...splitForSpeech(stripMarkdown(text.slice(pipe.fence))));
    for (const s of rest) pipe.queue.push(s);
    pipe.queue.end();
    if (blockedRef.current?.key === pipe.key && mountedRef.current) setBlocked({ key: pipe.key, text });
    return "speak" as const;
  }, []);

  const complete = useCallback((botKey: string, text: string, status: UiMessage["status"]) => {
    if (status === "done") markLatency("reply_done");
    const pipe = pipeRef.current?.key === botKey ? pipeRef.current : null;
    if (status !== "streaming" && pipe) pipeRef.current = null;
    if (pipe?.queue && status !== "streaming" && latestRef.current === botKey && mountedRef.current) {
      return finishPipe(pipe as Pipe & { queue: TtsQueue }, text, status);
    }
    const decision = run(botKey, text, status, latestRef.current !== botKey, status !== "streaming");
    // 回复出错或不会朗读(开关关闭/过期/隐藏等):这一轮到此为止,避免之后的手动朗读被记到它头上
    if (status !== "streaming" && decision !== "speak") abortLatencyTrace();
    return decision;
  }, [run, finishPipe]);

  /** R10:场景开场白;用户已经发过消息就不再读。跳过后同一 key 不再读。 */
  const speakOpening = useCallback((key: string, text: string) => run(key, text, "done", latestRef.current !== null, true), [run]);

  /** 切换会话:之前的一切过期,提示与报错标记重置(不停止播放,由调用方 player.stop()) */
  const reset = useCallback(() => {
    genRef.current += 1;
    latestRef.current = null;
    pipeRef.current = null;
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
    blockedRef.current = null; // 与 tapToRead 一致:同一时刻紧跟的点击不会再播放
    if (mountedRef.current) setBlocked(null);
  }, []);

  return { prime, begin, progress, complete, speakOpening, reset, blocked, tapToRead, dismissBlocked };
}
