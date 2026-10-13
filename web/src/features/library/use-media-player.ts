import { useEffect, useRef, useState, useSyncExternalStore } from "react";

/** 播放缓冲(spec §6.3 第 6 条):提前 150 ms 开始,延后 250 ms 才算这句结束。只在网页端,不进库。 */
export const PAD_BEFORE_MS = 150;
export const PAD_AFTER_MS = 250;
/** 库自己的速度档位(不碰全局 PLAYBACK_RATES,那是给 TTS 的;spec §11.4)。 */
export const RATES = [0.5, 0.75, 1, 1.25] as const;
export type Rate = (typeof RATES)[number];
export type LoopMode = "off" | "infinite" | 3 | 5;
export const LOOP_MODES: readonly LoopMode[] = ["off", "infinite", 3, 5];

export interface Seg { idx: number; startMs: number; endMs: number }

/** 控制器需要的媒体元素能力;HTMLMediaElement 天然满足,测试用假的。 */
export interface MediaLike {
  currentTime: number;
  readonly paused: boolean;
  playbackRate: number;
  defaultPlaybackRate: number;
  play(): Promise<void> | void;
  pause(): void;
  addEventListener(type: string, listener: () => void): void;
  removeEventListener(type: string, listener: () => void): void;
}

export interface Frames { request(fn: () => void): number; cancel(id: number): void }

export interface PlayerState {
  index: number;
  playing: boolean;
  loop: LoopMode;
  rate: Rate;
  /** 当前句已经回跳的次数(N 遍循环 = 首播 + N−1 次回跳)。 */
  repeats: number;
  /** 只播这一句,播完暂停(W2 的「听原句」)。 */
  once: boolean;
}

/** 起点 ≤ ms 的最后一句;都在 ms 之后则 −1。 */
export function segmentIndexAt(segs: readonly Seg[], ms: number): number {
  let lo = 0;
  let hi = segs.length - 1;
  let found = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (segs[mid].startMs <= ms) {
      found = mid;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }
  return found;
}

export function rateFromPct(pct: number | null | undefined): Rate {
  const want = (pct ?? 100) / 100;
  return RATES.reduce<Rate>((best, r) => (Math.abs(r - want) < Math.abs(best - want) ? r : best), 1);
}

export const pctFromRate = (rate: Rate): number => Math.round(rate * 100);

export function nextLoop(mode: LoopMode): LoopMode {
  return LOOP_MODES[(LOOP_MODES.indexOf(mode) + 1) % LOOP_MODES.length];
}

export function nextRate(rate: Rate): Rate {
  return RATES[(RATES.indexOf(rate) + 1) % RATES.length];
}

/** 速度:playbackRate 与 defaultPlaybackRate 都设(换 src 后 load 会回到 default),并保持音高。 */
export function applyRate(media: MediaLike, rate: Rate): void {
  const m = media as MediaLike & { preservesPitch?: boolean; webkitPreservesPitch?: boolean };
  try {
    m.preservesPitch = true;
    m.webkitPreservesPitch = true;
    media.defaultPlaybackRate = rate;
    media.playbackRate = rate;
  } catch {
    /* 浏览器不支持该倍速:保持原速 */
  }
}

const startOf = (seg: Seg) => Math.max(0, seg.startMs - PAD_BEFORE_MS) / 1000;

/**
 * 与 React 无关的播放控制器(R-L13):播放中用 requestAnimationFrame 轮询 currentTime(timeupdate 只有约 250 ms 粒度),
 * 实现单句循环 / N 遍循环 / 只播一句,并跟踪当前句。
 */
export class PlayerController {
  private state: PlayerState;
  private frame: number | null = null;
  /** 循环已结束的那一句:在它与下一句之间的空隙里不再回跳。 */
  private released = -1;
  private readonly listeners = new Set<() => void>();
  private readonly onPlay = () => {
    this.patch({ playing: true });
    this.schedule();
  };
  private readonly onPause = () => {
    this.patch({ playing: false });
    this.stopFrames();
  };

  constructor(private readonly media: MediaLike, private segs: readonly Seg[], private readonly frames: Frames,
    init: { rate?: Rate; index?: number } = {}) {
    const index = init.index !== undefined && segs[init.index] ? init.index : segs.length ? 0 : -1;
    this.state = { index, playing: !media.paused, loop: "off", rate: init.rate ?? 1, repeats: 0, once: false };
    applyRate(media, this.state.rate);
    media.addEventListener("play", this.onPlay);
    media.addEventListener("pause", this.onPause);
    media.addEventListener("ended", this.onPause);
    if (!media.paused) this.schedule();
  }

  readonly getState = (): PlayerState => this.state;

  readonly subscribe = (fn: () => void): (() => void) => {
    this.listeners.add(fn);
    return () => { this.listeners.delete(fn); };
  };

  destroy(): void {
    this.stopFrames();
    this.media.removeEventListener("play", this.onPlay);
    this.media.removeEventListener("pause", this.onPause);
    this.media.removeEventListener("ended", this.onPause);
    this.listeners.clear();
  }

  /** 句子起止被 W2 微调后换上新的列表。 */
  setSegments(segs: readonly Seg[]): void {
    this.segs = segs;
  }

  currentMs(): number {
    return Math.round(this.media.currentTime * 1000);
  }

  private patch(p: Partial<PlayerState>): void {
    this.state = { ...this.state, ...p };
    for (const l of [...this.listeners]) l();
  }

  private schedule(): void {
    if (this.frame !== null) return;
    this.frame = this.frames.request(() => {
      this.frame = null;
      this.tick();
      if (!this.media.paused) this.schedule();
    });
  }

  private stopFrames(): void {
    if (this.frame !== null) this.frames.cancel(this.frame);
    this.frame = null;
  }

  /** 每帧一次:先处理当前句的循环 / 只播一句,再按时间推进当前句。 */
  tick(): void {
    const ms = this.media.currentTime * 1000;
    const { index, loop, once, repeats } = this.state;
    const seg = this.segs[index];
    const pinned = !!seg && (once || (loop !== "off" && this.released !== index));
    if (pinned && seg) {
      if (ms < seg.endMs + PAD_AFTER_MS) return;
      if (once) {
        this.patch({ once: false });
        this.media.pause();
        return;
      }
      const total = loop === "infinite" ? Number.POSITIVE_INFINITY : (loop as number);
      if (repeats + 1 < total) {
        this.patch({ repeats: repeats + 1 });
        this.media.currentTime = startOf(seg);
        return;
      }
      this.released = index;
    }
    const natural = segmentIndexAt(this.segs, ms);
    if (natural !== -1 && natural !== index) {
      this.released = -1;
      this.patch({ index: natural, repeats: 0 });
    }
  }

  play(): void {
    try {
      const result = this.media.play();
      if (result && typeof (result as Promise<void>).catch === "function") {
        (result as Promise<void>).catch(() => this.patch({ playing: false }));
      }
    } catch {
      this.patch({ playing: false });
    }
  }

  pause(): void {
    this.media.pause();
  }

  toggle(): void {
    if (this.media.paused) this.play();
    else this.pause();
  }

  seekTo(idx: number, play = true): void {
    const seg = this.segs[idx];
    if (!seg) return;
    this.released = -1;
    this.patch({ index: idx, repeats: 0, once: false });
    this.media.currentTime = startOf(seg);
    if (play) this.play();
  }

  playOnce(idx: number): void {
    if (!this.segs[idx]) return;
    this.seekTo(idx, false);
    this.patch({ once: true });
    this.play();
  }

  prev(): void {
    this.seekTo(Math.max(0, this.state.index - 1));
  }

  next(): void {
    this.seekTo(Math.min(this.segs.length - 1, this.state.index + 1));
  }

  setLoop(loop: LoopMode): void {
    this.released = -1;
    this.patch({ loop, repeats: 0 });
  }

  setRate(rate: Rate): void {
    applyRate(this.media, rate);
    this.patch({ rate });
  }

  /** 续播(R-L14):跳到保存的位置;保存的句号无效时按时间找。 */
  restore(ms: number, idx: number): void {
    this.media.currentTime = Math.max(0, ms) / 1000;
    const byTime = segmentIndexAt(this.segs, ms);
    const index = this.segs[idx] && idx >= byTime ? idx : byTime >= 0 ? byTime : this.segs.length ? 0 : -1;
    this.released = -1;
    this.patch({ index, repeats: 0 });
  }
}

/** W2 的跟读面板能用的播放能力(R-L16)。 */
export type PlayerHandle = Pick<PlayerController, "pause" | "playOnce" | "seekTo" | "getState">;

const browserFrames: Frames = {
  request: (fn) => requestAnimationFrame(() => fn()),
  cancel: (id) => cancelAnimationFrame(id),
};
const NO_SUBSCRIBE = () => () => {};
const NO_STATE = (): PlayerState | null => null;

/** 把控制器接到真实的 <video>/<audio>(callback ref 得到的元素)。 */
export function useMediaPlayer(media: MediaLike | null, segments: readonly Seg[], init: { rate: Rate; index: number }) {
  const [controller, setController] = useState<PlayerController | null>(null);
  const initRef = useRef(init);
  initRef.current = init;
  const segRef = useRef(segments);
  segRef.current = segments;
  useEffect(() => {
    if (!media) return;
    const c = new PlayerController(media, segRef.current, browserFrames, initRef.current);
    setController(c);
    return () => {
      c.destroy();
      setController(null);
    };
  }, [media]);
  useEffect(() => {
    controller?.setSegments(segments);
  }, [controller, segments]);
  const state = useSyncExternalStore<PlayerState | null>(
    controller ? controller.subscribe : NO_SUBSCRIBE,
    controller ? controller.getState : NO_STATE,
    controller ? controller.getState : NO_STATE,
  );
  return { controller, state };
}
