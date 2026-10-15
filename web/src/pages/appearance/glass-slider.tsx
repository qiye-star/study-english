import { useId } from "react";
import { cn } from "~/lib/cn";

/**
 * 主题自定义的滑块(设计稿 .sl):原生 range、6px 井轨道(已选部分 ink-2)、28px 白色拇指、44px 命中高度;
 * 数值写在右侧(.num)并作为 aria-valuetext。没有新依赖。
 */
export function GlassSlider({ id, label, value, min, max, step, format, onChange, hint, warn = false, disabled = false }: {
  id: string;
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  format(value: number): string;
  onChange(value: number): void;
  hint?: string;
  warn?: boolean;
  disabled?: boolean;
}) {
  const hintId = useId();
  const pct = ((value - min) / (max - min)) * 100;
  return (
    <div className="py-1.5">
      <div className="flex items-baseline justify-between text-sub">
        <label htmlFor={id} className="font-medium text-ink">{label}</label>
        <span aria-hidden className="num text-ink-2">{format(value)}</span>
      </div>
      <input
        id={id}
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        disabled={disabled}
        aria-valuetext={format(value)}
        aria-describedby={hint ? hintId : undefined}
        onChange={(e) => onChange(Number(e.target.value))}
        style={{ ["--p" as string]: `${pct}%` }}
        className={cn(
          "block h-11 w-full cursor-pointer appearance-none bg-transparent disabled:cursor-not-allowed disabled:opacity-40",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue/40 focus-visible:rounded-full",
          "[&::-webkit-slider-runnable-track]:h-1.5 [&::-webkit-slider-runnable-track]:rounded-full",
          "[&::-webkit-slider-runnable-track]:bg-[linear-gradient(90deg,rgb(var(--ink-2))_var(--p),var(--ink-wash-2)_var(--p))]",
          "[&::-moz-range-track]:h-1.5 [&::-moz-range-track]:rounded-full [&::-moz-range-track]:bg-wash-2",
          "[&::-moz-range-progress]:h-1.5 [&::-moz-range-progress]:rounded-full [&::-moz-range-progress]:bg-ink-2",
          "[&::-webkit-slider-thumb]:-mt-[11px] [&::-webkit-slider-thumb]:size-7 [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:rounded-full",
          "[&::-webkit-slider-thumb]:border-[0.5px] [&::-webkit-slider-thumb]:border-hair-2 [&::-webkit-slider-thumb]:bg-white",
          "[&::-webkit-slider-thumb]:shadow-[0_3px_10px_-2px_rgba(17,19,24,.35)]",
          "[&::-moz-range-thumb]:size-7 [&::-moz-range-thumb]:rounded-full [&::-moz-range-thumb]:border-[0.5px] [&::-moz-range-thumb]:border-hair-2 [&::-moz-range-thumb]:bg-white",
        )}
      />
      {hint ? <small id={hintId} className={cn("block text-meta", warn ? "text-amber" : "text-ink-2")}>{hint}</small> : null}
    </div>
  );
}
