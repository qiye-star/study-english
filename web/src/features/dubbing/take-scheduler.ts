import { muteAt, type LineWindow } from "./windows";

/**
 * 录制时间轴调度器(计划 L5 R14/W4)。按媒体时间驱动:窗口内静音、窗口开关各回调一次、片段结束后暂停。
 * 只用结构类型(与 library 的 MediaLike / Frames 同形),不导入 library,所以纯模块可以单独测试。
 */

export interface TakeMedia {
  currentTime: number;
  readonly paused: boolean;
  muted: boolean;
  playbackRate: number;
  play(): Promise<void> | void;
  pause(): void;
  addEventListener(type: string, listener: () => void): void;
  removeEventListener(type: string, listener: () => void): void;
}

export interface TakeFrames {
  request(fn: () => void): number;
  cancel(id: number): void;
}

export interface TakeSchedulerOptions {
  media: TakeMedia;
  frames: TakeFrames;
  windows: readonly LineWindow[];
  clipStartMs: number;
  clipEndMs: number;
  /** 开始前先跳回片段起点前的引导量(毫秒),让观众听到上下文。默认 1500。 */
  leadMs?: number;
  /** 片段终点之后再播的尾巴(毫秒)。默认 600。 */
  tailMs?: number;
  onOpen(idx: number, mediaMs: number): void;
  onClose(idx: number, mediaMs: number): void;
  onEnd(): void;
  /** 系统打断(切后台、来电、播放被拒绝等):调用方应停止采集。只报告一次。 */
  onInterrupted(): void;
}

export interface TakeScheduler {
  /** 必须在用户手势的同步阶段调用(iOS 需要)。 */
  start(): void;
  /** 释放:恢复不静音、停帧、摘掉监听;之后不再回调。 */
  destroy(): void;
}

type WindowState = "pending" | "open" | "closed";

export function createTakeScheduler(opts: TakeSchedulerOptions): TakeScheduler {
  const { media, frames, windows } = opts;
  const leadMs = opts.leadMs ?? 1500;
  const tailMs = opts.tailMs ?? 600;
  const state: WindowState[] = windows.map(() => "pending");
  let frameId: number | null = null;
  let running = false;
  let finishing = false;

  const stopFrames = () => {
    if (frameId !== null) frames.cancel(frameId);
    frameId = null;
  };

  const interrupt = () => {
    if (!running) return;
    running = false;
    stopFrames();
    media.muted = false;
    opts.onInterrupted();
  };

  const onPause = () => {
    // 我们自己在片段结束时的暂停不算打断。
    if (running && !finishing) interrupt();
  };

  const tick = () => {
    frameId = null;
    if (!running) return;
    const t = media.currentTime * 1000;
    media.muted = muteAt(windows, t);
    windows.forEach((w, i) => {
      if (state[i] === "pending" && t >= w.startMs) {
        state[i] = "open";
        opts.onOpen(w.idx, t);
      }
      if (state[i] === "open" && t >= w.endMs) {
        state[i] = "closed";
        opts.onClose(w.idx, t);
      }
    });
    if (t >= opts.clipEndMs + tailMs) {
      finish();
      return;
    }
    frameId = frames.request(tick);
  };

  function finish() {
    running = false;
    finishing = true;
    stopFrames();
    media.muted = false;
    media.pause();
    opts.onEnd();
  }

  return {
    start() {
      if (running) return;
      running = true;
      finishing = false;
      media.playbackRate = 1;
      media.currentTime = Math.max(0, opts.clipStartMs - leadMs) / 1000;
      media.muted = muteAt(windows, media.currentTime * 1000);
      media.addEventListener("pause", onPause);
      const playing = media.play();
      if (playing && typeof (playing as Promise<void>).catch === "function") {
        (playing as Promise<void>).catch(() => interrupt());
      }
      frameId = frames.request(tick);
    },
    destroy() {
      running = false;
      stopFrames();
      media.removeEventListener("pause", onPause);
      media.muted = false;
    },
  };
}
