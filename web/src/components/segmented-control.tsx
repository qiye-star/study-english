import { useRef, type KeyboardEvent, type ReactNode } from "react";
import { cn } from "@renderer/lib/utils";

export interface SegmentedOption<T extends string> {
  value: T;
  label: ReactNode;
  /** 选项需要文字名时(label 是图标)提供 */
  ariaLabel?: string;
  testId?: string;
}

/**
 * 分段控件(radiogroup):轨道 surface-2(暗色下 seg-track),选中片 seg-on + 发丝线;
 * 视觉 32px、命中 44px(.hit-expand)。←/→ 循环切换,Home/End 到首尾。
 * 液态皮肤(设计稿 .seg):井胶囊轨道 + 白色胶囊滑块,选中字是强调色。
 *   <SegmentedControl label="输入方式" value={mode} onChange={setMode}
 *     options={[{ value: "auto", label: "自动" }, { value: "ptt", label: "按住说话" }]} />
 */
export function SegmentedControl<T extends string>({
  label,
  value,
  onChange,
  options,
  disabled = false,
  className,
  optionClassName,
}: {
  label: string;
  value: T;
  onChange: (value: T) => void;
  options: readonly SegmentedOption<T>[];
  disabled?: boolean;
  className?: string;
  /** 如 "min-w-[72px]"(通话控制台) */
  optionClassName?: string;
}) {
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  const current = Math.max(0, options.findIndex((o) => o.value === value));

  const select = (index: number) => {
    if (disabled) return;
    const next = options[index];
    refs.current[index]?.focus();
    if (next && next.value !== value) onChange(next.value);
  };

  const onKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
    const last = options.length - 1;
    const target = {
      ArrowRight: current === last ? 0 : current + 1,
      ArrowDown: current === last ? 0 : current + 1,
      ArrowLeft: current === 0 ? last : current - 1,
      ArrowUp: current === 0 ? last : current - 1,
      Home: 0,
      End: last,
    }[event.key];
    if (target === undefined) return;
    event.preventDefault();
    select(target);
  };

  return (
    <div
      role="radiogroup"
      aria-label={label}
      aria-disabled={disabled || undefined}
      className={cn("inline-flex gap-0.5 rounded-badge bg-seg-track p-[3px] liquid:rounded-full liquid:bg-wash liquid:shadow-well", disabled && "opacity-50", className)}
    >
      {options.map((option, index) => {
        const checked = index === current;
        return (
          <button
            key={option.value}
            ref={(el) => {
              refs.current[index] = el;
            }}
            type="button"
            role="radio"
            aria-checked={checked}
            aria-label={option.ariaLabel}
            data-testid={option.testId}
            tabIndex={checked ? 0 : -1}
            disabled={disabled}
            onClick={() => select(index)}
            onKeyDown={onKeyDown}
            className={cn(
              "hit-expand inline-flex h-8 min-w-14 items-center justify-center rounded-lg border-[0.5px] px-3 text-sub transition-colors duration-fast ease-standard liquid:rounded-full",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
              checked
                ? "border-hair-2 bg-seg-on font-semibold text-ink shadow-seg liquid:border-transparent liquid:bg-surface liquid:text-blue liquid:shadow-[0_2px_8px_-3px_rgba(17,19,24,.25)] liquid:dark:bg-white/[.16]"
                : "border-transparent bg-transparent font-medium text-ink-2",
              optionClassName,
            )}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}
