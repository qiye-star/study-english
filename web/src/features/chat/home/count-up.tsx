import { useEffect, useRef, useState } from "react";

const DURATION = 700;

/** 轻量计数:从终值的 60% 起数,ease-out cubic;p ∈ [0,1]。 */
export function countUpValue(to: number, progress: number): number {
  const from = Math.floor(to * 0.6);
  const p = Math.min(1, Math.max(0, progress));
  return Math.round(from + (to - from) * (1 - (1 - p) ** 3));
}

/** 数字短(700 ms)而且只走后 40%,不抢戏。reduced / 无 rAF 时直接显示终值。 */
export function CountUp({ to, delayMs, reduced }: { to: number; delayMs: number; reduced: boolean }) {
  const [value, setValue] = useState(reduced ? to : countUpValue(to, 0));
  const raf = useRef(0);

  useEffect(() => {
    if (reduced || typeof requestAnimationFrame !== "function") {
      setValue(to);
      return;
    }
    const start = performance.now() + delayMs;
    const tick = (now: number) => {
      const p = (now - start) / DURATION;
      setValue(countUpValue(to, p));
      if (p < 1) raf.current = requestAnimationFrame(tick);
    };
    raf.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf.current);
  }, [to, delayMs, reduced]);

  return <b className="tabular-nums">{value}</b>;
}
