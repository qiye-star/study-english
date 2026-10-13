import { type CSSProperties, type MouseEvent, type ReactNode, useEffect, useRef, useState } from "react";
import { cn } from "@renderer/lib/utils";
import { motionAllowed } from "./motion";

export const SPARK_COUNT = 8;
export const SPARK_MS = 600;
const COLORS = ["#f2b056", "#2cc7b0", "#4b78f0", "#ff7a84"];

export interface Spark { id: number; x: number; y: number; dx: number; dy: number; color: string }

let nextId = 1;

/** 一次迸发:count 颗火花从 origin 向四周散开(半径 26–40 px,方向均分,确定性,不用随机数)。 */
export function sparkBurst(origin: { x: number; y: number }, count = SPARK_COUNT): Spark[] {
  return Array.from({ length: count }, (_, i) => {
    const angle = (i / count) * Math.PI * 2;
    const radius = 26 + (i % 3) * 7;
    return { id: nextId++, x: origin.x, y: origin.y, dx: Math.cos(angle) * radius, dy: Math.sin(angle) * radius, color: COLORS[i % COLORS.length] };
  });
}

/**
 * 点击处迸出小火花(ClickSpark):包住一个按钮,点击(捕获阶段,不拦截)时在点击位置生成火花,SPARK_MS 后清掉。
 * 动效关闭(减少动态效果 / 低端机 / disabled)时什么都不做;卸载时清掉定时器。
 */
export function ClickSpark({ children, className, disabled = false }: { children: ReactNode; className?: string; disabled?: boolean }) {
  const hostRef = useRef<HTMLSpanElement>(null);
  const timers = useRef(new Set<ReturnType<typeof setTimeout>>());
  const [sparks, setSparks] = useState<Spark[]>([]);

  useEffect(() => {
    const pending = timers.current;
    return () => pending.forEach(clearTimeout);
  }, []);

  const burst = (e: MouseEvent<HTMLSpanElement>) => {
    if (disabled || !motionAllowed()) return;
    const rect = hostRef.current?.getBoundingClientRect();
    const fresh = sparkBurst({ x: e.clientX - (rect?.left ?? 0), y: e.clientY - (rect?.top ?? 0) });
    setSparks((list) => [...list, ...fresh]);
    const timer = setTimeout(() => {
      timers.current.delete(timer);
      setSparks((list) => list.filter((s) => !fresh.includes(s)));
    }, SPARK_MS);
    timers.current.add(timer);
  };

  return (
    <span ref={hostRef} className={cn("lib-spark-host", className)} onClickCapture={burst}>
      {children}
      {sparks.map((s) => (
        <i key={s.id} aria-hidden className="lib-spark"
          style={{ left: s.x - 3, top: s.y - 3, background: s.color, "--dx": `${s.dx}px`, "--dy": `${s.dy}px` } as CSSProperties} />
      ))}
    </span>
  );
}
