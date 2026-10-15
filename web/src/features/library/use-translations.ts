import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ApiError, type ApiClient } from "~/api/client";
import { useAuth } from "~/auth/auth-context";
import { MAX_TRANSLATE_BATCH, isAiLimited, translateSegments, type LibrarySegment, type TranslateResult, type TranslatedSegment } from "./library-api";
import { zhFor } from "./translation-state";

/**
 * W2 的译文批量取(spec §9、E12;计划 R-SH27,按 W1 的接缝与真实服务端改写):W1 渲染译文行与骨架行、持有「译」开关和
 * `onTranslated`(播放器用 `mergeTranslations` 函数式合进句子表,所以一批结果一次交回、连续到达也不丢更新);本文件只负责「取」。
 * 锚点句前后各 `NEAR_SENTENCES` 句里还没有有效译文(语言与母语一致,`zhFor`)的句子,每次 ≤ 20 句(`MAX_TRANSLATE_BATCH`)、
 * 同一时刻最多一个请求、去重(在途 / 本会话失败过 / 刚取到的不再请求);额度满(`limited: true` 或 429)、404(AI 未开启)、连续 2 次失败
 * 就停止并给 W1 一个固定的 `notice`(不逐句报错);W1 的「重试」调 `retry()` = 新会话;关掉「译」= 会话结束。
 * 请求体只有句序号与母语码(句子文字在服务端按序号取),译文只进内存里的 `segment.zh`,不写任何存储。
 */

/** 锚点句前后各取这么多句(E12)。 */
export const NEAR_SENTENCES = 10;
/** 防抖:翻到下一句 / 一批结果回来之后,等这么久再发下一批。 */
export const FLUSH_DELAY_MS = 150;
const MAX_CONSECUTIVE_FAILURES = 2;
/** 测试用:忘掉所有「AI 不可用」记录。 */
export const resetUnavailable = () => unavailableItems.clear();

export interface UseTranslationsArgs {
  itemId: string;
  enabled: boolean;
  segments: readonly LibrarySegment[];
  /** 当前句序号:取它前后各 10 句 */
  anchorIdx: number;
  /** `nativeLanguageCode(language)` 的值(`zh-CN` / `es-ES`;英文界面不会 enabled) */
  native: string;
  onTranslated(items: TranslatedSegment[]): void;
}

export interface TranslationsState {
  pending: ReadonlySet<number>;
  notice: "limited" | "failed" | null;
  retry(): void;
}

export type TranslateNotice = "limited" | "failed";

/** 锚点附近的一句:是否已有有效译文。 */
export interface WindowRow {
  idx: number;
  hasZh: boolean;
}

export interface BatcherOptions {
  translate(indices: number[], signal: AbortSignal): Promise<TranslateResult>;
  /** 一批译文(只含请求过的句子) */
  onResult(items: TranslatedSegment[]): void;
  /** 正在取的句序号(骨架行);空集 = 空闲 */
  onPending(pending: ReadonlySet<number>): void;
  /** 额度满 / 失败的固定提示;会话结束或重试时给 null */
  onNotice(notice: TranslateNotice | null): void;
  delayMs?: number;
  /** 「AI 不可用」是否已判定(跨批处理器重建保留,重试 / 关「译」时清除) */
  unavailable?: { get(): boolean; set(on: boolean): void };
}

/** 503「AI is unavailable」(服务端没配 LLM):再试也没用,第一次失败就终止(重试按钮才开新会话)。 */
export function isAiUnavailable(err: unknown): boolean {
  return err instanceof ApiError && err.status === 503 && err.message === "AI is unavailable";
}

/** 按条目记住 AI 不可用,窗口重建(换母语 / 重新进入播放器)不会再发一轮请求;重试或关「译」清除。 */
const unavailableItems = new Set<string>();

const NONE: ReadonlySet<number> = new Set<number>();

/** 一个条目 + 一种母语的批处理器(与 React 无关,便于测试;销毁后所有回调静默)。 */
export class TranslationBatcher {
  private window: WindowRow[] = [];
  private readonly inflight = new Set<number>();
  private readonly failed = new Set<number>();
  /** 已交回、但 W1 的句子表可能还没反映出来的句子(sync 看到 hasZh 为真时移出) */
  private readonly done = new Set<number>();
  /** 见过有译文的句子:之后又变回没有 = 文字被改、译文被清,可以重新取 */
  private readonly had = new Set<number>();
  private enabled = false;
  private stopped = false;
  private failures = 0;
  private running = false;
  private disposed = false;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private controller: AbortController | null = null;

  constructor(private readonly opts: BatcherOptions) {
    this.stopped = opts.unavailable?.get() === true;
  }

  /** 用锚点附近的句子(升序)替换视野;有新的可取句子时排一次发送。 */
  sync(rows: readonly WindowRow[]): void {
    if (this.disposed) return;
    this.window = [...rows];
    for (const row of rows) {
      if (row.hasZh) {
        this.had.add(row.idx);
        this.done.delete(row.idx);
      } else if (this.had.delete(row.idx)) {
        this.failed.delete(row.idx);
        this.done.delete(row.idx);
      }
    }
    this.schedule();
  }

  setEnabled(on: boolean): void {
    if (on === this.enabled || this.disposed) return;
    this.enabled = on;
    if (on) {
      if (this.stopped) this.opts.onNotice("failed");
      this.schedule();
      return;
    }
    this.reset(); // 关掉 = 这一轮结束:中止在途请求、清空状态,下次打开是新会话
    this.opts.onNotice(null);
  }

  /** W1 的「重试」:清空失败与停止状态,马上排一次。 */
  retry(): void {
    if (this.disposed || !this.enabled) return;
    this.reset();
    this.opts.onNotice(null);
    this.schedule();
  }

  dispose(): void {
    this.disposed = true;
    this.enabled = false;
    this.reset();
    this.window = [];
  }

  private reset(): void {
    this.controller?.abort();
    this.controller = null;
    this.clearTimer();
    this.inflight.clear();
    this.failed.clear();
    this.done.clear();
    this.stopped = false;
    this.failures = 0;
    if (!this.disposed) this.opts.unavailable?.set(false);
    if (!this.disposed) this.opts.onPending(NONE);
  }

  private clearTimer(): void {
    if (this.timer !== null) clearTimeout(this.timer);
    this.timer = null;
  }

  private schedule(): void {
    if (!this.enabled || this.stopped || this.disposed || this.timer !== null || this.running) return;
    if (this.pick().length === 0) return;
    this.timer = setTimeout(() => {
      this.timer = null;
      void this.flush();
    }, this.opts.delayMs ?? FLUSH_DELAY_MS);
  }

  private pick(): number[] {
    const out: number[] = [];
    for (const row of this.window) {
      if (!row.hasZh && !this.inflight.has(row.idx) && !this.failed.has(row.idx) && !this.done.has(row.idx)) out.push(row.idx);
      if (out.length >= MAX_TRANSLATE_BATCH) break;
    }
    return out;
  }

  /** 一次发一批;结束(含被中止)后在 finally 里再排下一次。被中止的请求不改任何状态。 */
  private async flush(): Promise<void> {
    if (this.running || this.disposed) return;
    this.running = true;
    try {
      const batch = this.pick();
      if (!batch.length || !this.enabled || this.stopped) return;
      const controller = new AbortController();
      this.controller = controller;
      const alive = () => !controller.signal.aborted && !this.disposed && this.enabled;
      for (const idx of batch) this.inflight.add(idx);
      this.opts.onPending(new Set(batch));
      let result: TranslateResult;
      try {
        result = await this.opts.translate(batch, controller.signal);
      } catch (err) {
        if (!alive()) return;
        for (const idx of batch) {
          this.inflight.delete(idx);
          this.failed.add(idx);
        }
        this.failures += 1;
        const limited = isAiLimited(err);
        if (isAiUnavailable(err)) this.opts.unavailable?.set(true);
        if (limited || isAiUnavailable(err) || (err instanceof ApiError && err.status === 404) || this.failures >= MAX_CONSECUTIVE_FAILURES) this.stopped = true;
        this.opts.onPending(NONE);
        this.opts.onNotice(limited ? "limited" : "failed");
        return;
      }
      if (!alive()) return;
      this.failures = 0;
      const asked = new Set(batch);
      const items = result.items.filter((item) => asked.has(item.idx) && item.zh);
      const got = new Set(items.map((item) => item.idx));
      for (const idx of batch) {
        this.inflight.delete(idx);
        if (got.has(idx)) this.done.add(idx);
        else if (!result.limited) this.failed.add(idx); // 没返回又不是额度满:当作失败,不反复请求
      }
      this.opts.onPending(NONE);
      if (items.length) this.opts.onResult(items);
      if (result.limited) {
        this.stopped = true;
        this.opts.onNotice("limited");
      }
    } finally {
      this.running = false;
      this.schedule();
    }
  }
}

/**
 * W1 的 `player-page.tsx` 调用(接缝不变):`enabled` 为假时什么也不请求;`pending` 给 W1 画骨架;`notice` 给 W1 显示固定提示。
 * 批处理器随 (条目, 母语) 重建;`segments` / `anchorIdx` 变化只刷新视野。
 */
export function useTranslations({ itemId, enabled, segments, anchorIdx, native, onTranslated }: UseTranslationsArgs): TranslationsState {
  const { api } = useAuth();
  const [pending, setPending] = useState<TranslationsState["pending"]>(NONE);
  const [notice, setNotice] = useState<TranslationsState["notice"]>(null);
  const apiRef = useRef<ApiClient>(api);
  apiRef.current = api;
  const onTranslatedRef = useRef(onTranslated);
  onTranslatedRef.current = onTranslated;
  const batcherRef = useRef<TranslationBatcher | null>(null);

  useEffect(() => {
    setPending(NONE);
    setNotice(null);
    const batcher = new TranslationBatcher({
      translate: (indices, signal) => translateSegments(apiRef.current, itemId, indices, native, signal),
      onResult: (items) => onTranslatedRef.current(items),
      onPending: setPending,
      onNotice: setNotice,
      unavailable: {
        get: () => unavailableItems.has(itemId),
        set: (on) => { if (on) unavailableItems.add(itemId); else unavailableItems.delete(itemId); },
      },
    });
    batcherRef.current = batcher;
    return () => {
      batcher.dispose();
      if (batcherRef.current === batcher) batcherRef.current = null;
    };
  }, [itemId, native]);

  const rows = useMemo<WindowRow[]>(() => {
    const out: WindowRow[] = [];
    for (const seg of segments) {
      if (Math.abs(seg.idx - anchorIdx) <= NEAR_SENTENCES) out.push({ idx: seg.idx, hasZh: zhFor(seg, native) !== null });
    }
    return out;
  }, [segments, anchorIdx, native]);

  // 先 sync 再 setEnabled:打开的那一刻视野已经是新的
  useEffect(() => {
    batcherRef.current?.sync(rows);
  }, [rows, itemId, native]);
  useEffect(() => {
    batcherRef.current?.setEnabled(enabled);
  }, [enabled, itemId, native]);

  const retry = useCallback(() => batcherRef.current?.retry(), []);
  return { pending, notice, retry };
}
