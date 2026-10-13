import { type CSSProperties, useLayoutEffect, useRef, useState } from "react";
import { cn } from "@renderer/lib/utils";

const KNOB_PX = 22;

/** 指针位置 → 最近的档位序号(轨道外夹在两端;轨道宽度为 0 或只有一档时为 0)。 */
export function snapIndex(x: number, left: number, width: number, count: number): number {
  if (count <= 1 || width <= 0) return 0;
  const p = Math.min(1, Math.max(0, (x - left) / width));
  return Math.round(p * (count - 1));
}

/**
 * 弹性滑块(ElasticSlider):拖动 / 点按吸附到 `steps` 的某一档,弹性手感来自 transform 的回弹缓动(只动 transform,不触发布局;
 * 减少动态效果时 transition 关闭,见 library.css)。可键盘操作(← → ↑ ↓)。播放速度用它(R-L31)。
 */
export function ElasticSlider<T extends number>({ steps, value, onChange, label, format = String, className }: {
  steps: readonly T[];
  value: T;
  onChange(next: T): void;
  label: string;
  format?: (v: T) => string;
  className?: string;
}) {
  const trackRef = useRef<HTMLDivElement>(null);
  const [drag, setDrag] = useState(false);
  const [width, setWidth] = useState(0);
  const index = Math.max(0, steps.indexOf(value));
  const p = steps.length > 1 ? index / (steps.length - 1) : 0;

  useLayoutEffect(() => {
    const el = trackRef.current;
    if (!el) return;
    const measure = () => setWidth(el.getBoundingClientRect().width);
    measure();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const choose = (clientX: number) => {
    const rect = trackRef.current?.getBoundingClientRect();
    if (!rect) return;
    const next = steps[snapIndex(clientX, rect.left, rect.width, steps.length)];
    if (next !== undefined && next !== value) onChange(next);
  };
  const step = (delta: number) => {
    const next = steps[Math.min(steps.length - 1, Math.max(0, index + delta))];
    if (next !== undefined && next !== value) onChange(next);
  };

  return (
    <div className={cn("lib-slider", className)} data-drag={drag || undefined}>
      <div
        ref={trackRef}
        role="slider"
        tabIndex={0}
        aria-label={label}
        aria-orientation="horizontal"
        aria-valuemin={steps[0]}
        aria-valuemax={steps[steps.length - 1]}
        aria-valuenow={value}
        aria-valuetext={format(value)}
        className="lib-slider-track"
        style={{ "--p": p } as CSSProperties}
        onPointerDown={(e) => {
          e.currentTarget.setPointerCapture?.(e.pointerId);
          setDrag(true);
          choose(e.clientX);
        }}
        onPointerMove={(e) => { if (drag) choose(e.clientX); }}
        onPointerUp={() => setDrag(false)}
        onPointerCancel={() => setDrag(false)}
        onKeyDown={(e) => {
          const delta = e.key === "ArrowRight" || e.key === "ArrowUp" ? 1 : e.key === "ArrowLeft" || e.key === "ArrowDown" ? -1 : 0;
          if (!delta) return;
          e.preventDefault();
          step(delta);
        }}
      >
        <div className="lib-slider-rail"><div className="lib-slider-fill" /></div>
        <div className="lib-slider-knob" style={{ transform: `translateX(${p * Math.max(0, width - KNOB_PX)}px) scale(${drag ? 1.25 : 1})` }} />
      </div>
      <div aria-hidden className="lib-slider-ticks">
        {steps.map((s) => <span key={s}>{format(s)}</span>)}
      </div>
    </div>
  );
}
