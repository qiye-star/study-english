import { useEffect, useRef, useState } from "react";

/** 可暂停的一次性倒计时(只记剩余毫秒,不依赖帧);卸载 / cancel 后不再回调。 */
export class Countdown {
  private left: number;
  private startedAt = 0;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private finished = false;

  constructor(private readonly ms: number, private readonly onDone: () => void) {
    this.left = ms;
  }

  /** 开始或继续。 */
  start(): void {
    if (this.timer !== null || this.finished) return;
    this.startedAt = Date.now();
    this.timer = setTimeout(() => {
      this.timer = null;
      this.left = 0;
      this.finished = true;
      this.onDone();
    }, this.left);
  }

  pause(): void {
    if (this.timer === null) return;
    clearTimeout(this.timer);
    this.timer = null;
    this.left = Math.max(0, this.left - (Date.now() - this.startedAt));
  }

  cancel(): void {
    if (this.timer !== null) clearTimeout(this.timer);
    this.timer = null;
    this.finished = true;
  }

  /** 剩余毫秒(运行中也是实时的)。 */
  remaining(): number {
    return this.timer === null ? this.left : Math.max(0, this.left - (Date.now() - this.startedAt));
  }

  get total(): number {
    return this.ms;
  }
}

/**
 * 倒计时钩子:`active` 变 true 时开始(只开始一次),`paused` 期间暂停;到点调用 onDone 一次。
 * 返回给界面显示的剩余秒数(向上取整,不低于 1,不每秒播报,只供视觉)。
 */
export function useCountdown({ ms, active, paused, onDone }: { ms: number; active: boolean; paused: boolean; onDone: () => void }): number {
  const [seconds, setSeconds] = useState(Math.ceil(ms / 1000));
  const done = useRef(onDone);
  done.current = onDone;
  const cd = useRef<Countdown | null>(null);

  useEffect(() => {
    if (!active) return;
    const c = new Countdown(ms, () => done.current());
    cd.current = c;
    c.start();
    const tick = setInterval(() => setSeconds(Math.max(1, Math.ceil(c.remaining() / 1000))), 200);
    return () => {
      clearInterval(tick);
      c.cancel();
      cd.current = null;
    };
  }, [active, ms]);

  useEffect(() => {
    if (paused) cd.current?.pause();
    else if (active) cd.current?.start();
  }, [paused, active]);

  return seconds;
}
