import type { DubbingTake, LineResult } from "./dubbing-api";
import { createLineQueue, type LineOutcome, type LineQueue, type QueueItem } from "./line-queue";
import type { TakeCapture } from "./take-capture";
import type { TakeScheduler } from "./take-scheduler";
import type { LineWindow } from "./windows";

/**
 * 一次录制的编排(计划 L5 R13–R15、W6):开麦 → 放视频 → 建 take → 窗口切片入队评测 → 片段结束后等待并 finish。
 * 纯 TS 状态机,不碰 React;真实依赖由 use-dub-take.ts 注入。
 */

export type TakeState = "idle" | "starting" | "recording" | "finishing" | "done" | "error" | "interrupted";

export const DRAIN_TIMEOUT_MS = 60_000;

export interface TakeResult {
  take: DubbingTake;
  outcomes: LineOutcome[];
  /** 每句录音的 object URL(「我的」回放用;卸载时 dispose 释放) */
  urls: Map<number, string>;
}

export interface SchedulerCallbacks {
  windows: readonly LineWindow[];
  clipStartMs: number;
  clipEndMs: number;
  onOpen(idx: number, mediaMs: number): void;
  onClose(idx: number, mediaMs: number): void;
  onEnd(): void;
  onInterrupted(): void;
}

export interface TakeRunnerDeps {
  startCapture(startMediaMs: number, onInterrupted: () => void): TakeCapture;
  createScheduler(cb: SchedulerCallbacks): TakeScheduler;
  createTake(): Promise<DubbingTake>;
  finishTake(dubId: string): Promise<DubbingTake>;
  assess(item: QueueItem, signal: AbortSignal): Promise<{ assessmentId: string }>;
  post(dubId: string, item: QueueItem, assessmentId: string, signal: AbortSignal): Promise<LineResult>;
  /** 音频焦点:别的声音抢走时调用 stop */
  claim(stop: () => void): void;
  release(stop: () => void): void;
  createObjectURL(blob: Blob): string;
  revokeObjectURL(url: string): void;
  now(): number;
}

export interface TakeRunner {
  start(): void;
  /** 用户放弃这一遍:释放一切,回到 idle(take 行保持 recording,列表里显示「未完成」)。 */
  stop(): void;
  dispose(): void;
  state(): TakeState;
  result(): TakeResult | null;
  subscribe(fn: (s: TakeState) => void): () => void;
}

export function createTakeRunner(opts: { windows: readonly LineWindow[]; clipStartMs: number; clipEndMs: number; deps: TakeRunnerDeps }): TakeRunner {
  const { deps } = opts;
  let st: TakeState = "idle";
  let capture: TakeCapture | null = null;
  let scheduler: TakeScheduler | null = null;
  let queue: LineQueue | null = null;
  let takeReady: Promise<string> | null = null;
  let claimed = false;
  let res: TakeResult | null = null;
  const urls = new Map<number, string>();
  const listeners = new Set<(s: TakeState) => void>();

  const set = (s: TakeState) => {
    st = s;
    for (const fn of listeners) fn(s);
  };
  /** 读当前状态(不让控制流分析把它窄化在 set 之后)。 */
  const cur = (): TakeState => st;

  const onAudioStolen = () => interrupt();

  function teardown() {
    capture?.release();
    scheduler?.destroy();
    queue?.abort();
    if (claimed) {
      claimed = false;
      deps.release(onAudioStolen);
    }
  }

  function interrupt() {
    if (st === "idle" || st === "done" || st === "error" || st === "interrupted") return;
    set("interrupted");
    teardown();
  }

  function fail() {
    if (st !== "starting") return;
    teardown();
    set("error");
  }

  function enqueueClip(c: { idx: number; recStartMs: number; capture: "pcm" | "recorder"; noSpeech: boolean; voicedMs: number | null; wav: Blob | null }) {
    if (c.wav) urls.set(c.idx, deps.createObjectURL(c.wav));
    queue?.enqueue(c);
  }

  async function endTake() {
    if (st !== "recording" && st !== "starting") return;
    set("finishing");
    const tail = (await capture?.finish()) ?? [];
    for (const c of tail) enqueueClip(c);
    const outcomes = (await queue?.drain(DRAIN_TIMEOUT_MS)) ?? [];
    if (cur() !== "finishing") return; // 中途被打断:不再 finish
    try {
      const id = await takeReady;
      if (!id) throw new Error("no take");
      const take = await deps.finishTake(id);
      res = { take, outcomes, urls };
      teardown();
      set("done");
    } catch {
      teardown();
      set("error");
    }
  }

  return {
    start() {
      if (st !== "idle" && st !== "done" && st !== "error" && st !== "interrupted") return;
      res = null;
      urls.clear();
      set("starting");
      claimed = true;
      deps.claim(onAudioStolen);
      // 同步阶段:先开麦,再放视频(手势内),最后才等建 take。
      capture = deps.startCapture(deps.now(), interrupt);
      queue = createLineQueue({
        assess: (item, signal) => deps.assess(item, signal),
        post: async (item, assessmentId, signal) => {
          const id = await takeReady;
          if (!id) throw new Error("no take");
          return deps.post(id, item, assessmentId, signal);
        },
      });
      scheduler = deps.createScheduler({
        windows: opts.windows,
        clipStartMs: opts.clipStartMs,
        clipEndMs: opts.clipEndMs,
        onOpen: (idx, mediaMs) => capture?.open(idx, mediaMs),
        onClose: (idx, mediaMs) => {
          const c = capture?.close(idx, mediaMs);
          if (c) enqueueClip(c);
        },
        onEnd: () => { void endTake(); },
        onInterrupted: interrupt,
      });
      scheduler.start();
      const created: Promise<string> = deps.createTake()
        .then((take): string => {
          if (cur() === "starting") set("recording");
          return take.id;
        }, (): string => {
          fail();
          return "";
        })
        .then((id: string): string => {
          if (!id) throw new Error("no take");
          return id;
        });
      created.catch((): void => undefined);
      takeReady = created;
    },
    stop() {
      if (st === "idle") return;
      teardown();
      set("idle");
    },
    dispose() {
      teardown();
      for (const url of urls.values()) deps.revokeObjectURL(url);
      urls.clear();
      res = null;
      listeners.clear();
    },
    state: () => st,
    result: () => res,
    subscribe(fn) {
      listeners.add(fn);
      return () => { listeners.delete(fn); };
    },
  };
}
