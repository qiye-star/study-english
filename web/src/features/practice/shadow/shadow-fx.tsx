import { type CSSProperties, type MouseEvent, type ReactNode, useEffect, useRef, useState } from "react";

/**
 * 低端机(html.lite)或系统开了「减少动态效果」时为 false:JS 驱动的效果直接给终态。
 * 与 features/library/fx/motion.ts 同一规则(R-S07:不能跨 feature 导入,本地一份)。
 */
export function motionAllowed(win: Window = window): boolean {
  if (win.document.documentElement.classList.contains("lite")) return false;
  try {
    return !win.matchMedia("(prefers-reduced-motion: reduce)").matches;
  } catch {
    return true;
  }
}

/** 数字滚动的缓动:ease-out cubic,progress ∈ [0, 1]。 */
export function countUpValue(progress: number, to: number): number {
  const p = Math.min(1, Math.max(0, progress));
  return to * (1 - Math.pow(1 - p, 3));
}

/** 数字从当前值滚到 `to`;动效关闭(enabled === false 或 motionAllowed() 为 false)时直接给终值。 */
export function useCountUp(to: number, opts: { durationMs?: number; enabled?: boolean } = {}): number {
  const { durationMs = 1100 } = opts;
  const animate = opts.enabled ?? motionAllowed();
  const [value, setValue] = useState(animate ? 0 : to);
  const latest = useRef(value);
  latest.current = value;

  useEffect(() => {
    if (!animate) {
      setValue(to);
      return undefined;
    }
    const from = latest.current;
    let id = 0;
    let start: number | null = null;
    const step = (now: number) => {
      start ??= now;
      const p = Math.min(1, (now - start) / durationMs);
      setValue(from + (to - from) * countUpValue(p, 1));
      if (p < 1) id = window.requestAnimationFrame(step);
    };
    id = window.requestAnimationFrame(step);
    return () => window.cancelAnimationFrame(id);
  }, [to, durationMs, animate]);

  return value;
}

const SPARK_COUNT = 8;
const SPARK_MS = 600;
const COLORS = ["rgb(var(--amber))", "rgb(var(--teal))", "rgb(var(--blue))", "rgb(var(--red))"];

interface Spark { id: number; x: number; y: number; dx: number; dy: number; color: string }
let nextId = 1;

/** 一次迸发:SPARK_COUNT 颗火花从点击处向四周散开(半径 26–40 px,方向均分,确定性,不用随机数)。 */
function burst(origin: { x: number; y: number }): Spark[] {
  return Array.from({ length: SPARK_COUNT }, (_, i) => {
    const angle = (i / SPARK_COUNT) * Math.PI * 2;
    const radius = 26 + (i % 3) * 7;
    return { id: nextId++, x: origin.x, y: origin.y, dx: Math.cos(angle) * radius, dy: Math.sin(angle) * radius, color: COLORS[i % COLORS.length] };
  });
}

/** 点击处迸出小火花(「收藏」):包住一个按钮;动效关闭 / disabled 时什么都不做;卸载时清掉定时器。 */
export function ClickSpark({ children, disabled = false }: { children: ReactNode; disabled?: boolean }) {
  const hostRef = useRef<HTMLSpanElement>(null);
  const timers = useRef(new Set<ReturnType<typeof setTimeout>>());
  const [sparks, setSparks] = useState<Spark[]>([]);

  useEffect(() => {
    const pending = timers.current;
    return () => pending.forEach(clearTimeout);
  }, []);

  const onClickCapture = (e: MouseEvent<HTMLSpanElement>) => {
    if (disabled || !motionAllowed()) return;
    const rect = hostRef.current?.getBoundingClientRect();
    const fresh = burst({ x: e.clientX - (rect?.left ?? 0), y: e.clientY - (rect?.top ?? 0) });
    setSparks((list) => [...list, ...fresh]);
    const timer = setTimeout(() => {
      timers.current.delete(timer);
      setSparks((list) => list.filter((s) => !fresh.includes(s)));
    }, SPARK_MS);
    timers.current.add(timer);
  };

  return (
    <span ref={hostRef} className="shs-spark-host" onClickCapture={onClickCapture}>
      {children}
      {sparks.map((s) => (
        <i key={s.id} aria-hidden className="shs-spark"
          style={{ left: s.x - 3, top: s.y - 3, background: s.color, "--dx": `${s.dx}px`, "--dy": `${s.dy}px` } as CSSProperties} />
      ))}
    </span>
  );
}
