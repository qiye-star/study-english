import { type HTMLAttributes, useEffect, useRef, useState } from "react";
import { cn } from "@renderer/lib/utils";
import { type FrameSource, browserFrames, motionAllowed } from "./motion";

/** 数字滚动的缓动:ease-out cubic,progress ∈ [0, 1]。 */
export function countUpValue(progress: number, to: number): number {
  const p = Math.min(1, Math.max(0, progress));
  return to * (1 - Math.pow(1 - p, 3));
}

/**
 * 数字从当前值滚到 `to`(CountUp)。动效关闭(`enabled === false`,或系统减少动态效果 / 低端机)时直接给终值;
 * 目标变了从上一个值接着滚(不回到 0)。帧源可注入,测试用假的。
 */
export function useCountUp(to: number, opts: { durationMs?: number; frames?: FrameSource; enabled?: boolean } = {}): number {
  const { durationMs = 1100, frames = browserFrames } = opts;
  const animate = opts.enabled ?? motionAllowed();
  const [value, setValue] = useState(animate ? 0 : to);
  const latest = useRef(value);
  latest.current = value;

  useEffect(() => {
    if (!animate) {
      setValue(to);
      return;
    }
    const from = latest.current;
    let id = 0;
    let start: number | null = null;
    const step = (now: number) => {
      start ??= now;
      const p = Math.min(1, (now - start) / durationMs);
      setValue(from + (to - from) * (countUpValue(p, 1)));
      if (p < 1) id = frames.request(step);
    };
    id = frames.request(step);
    return () => frames.cancel(id);
  }, [to, durationMs, animate, frames]);

  return value;
}

/** 数字滚动:可见的数字是动画值(aria-hidden),终值放在 sr-only 里给读屏与测试。 */
export function CountUp({ to, format = (n) => String(Math.round(n)), className, durationMs, frames, enabled }: {
  to: number;
  format?: (n: number) => string;
  className?: string;
  durationMs?: number;
  frames?: FrameSource;
  enabled?: boolean;
}) {
  const value = useCountUp(to, { durationMs, frames, enabled });
  return (
    <span className={className}>
      <span aria-hidden>{format(value)}</span>
      <span className="sr-only">{format(to)}</span>
    </span>
  );
}

/** 高分渐变字(GradientText):不支持 background-clip: text 时是纯色(library.css 的 @supports 守卫)。 */
export function GradientText({ className, ...rest }: HTMLAttributes<HTMLSpanElement>) {
  return <span className={cn("lib-gt", className)} {...rest} />;
}
