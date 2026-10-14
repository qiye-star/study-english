import { cn } from "~/lib/cn";

export interface ZhToggleProps {
  /** 当前是否显示中文 */
  pressed: boolean;
  onToggle: () => void;
  /** 可见文字(「中文」/ "Chinese"),由调用方从自己的文案传入;本组件不含文案 */
  label: string;
  testId?: string;
  className?: string;
}

/**
 * 「中文」切换按钮(计划 2026-10-14-review-bilingual-longpress R-Z2 / R-Z4):复习页答后「学习内容」区与查词抽屉共用。
 * 无状态;按下后仍显示(再点收回);44 px 命中、aria-pressed,名称就是可见文字。
 */
export function ZhToggle({ pressed, onToggle, label, testId = "zh-toggle", className }: ZhToggleProps) {
  return (
    <button type="button" data-testid={testId} aria-pressed={pressed} onClick={onToggle}
      className={cn(
        "inline-flex min-h-tap min-w-tap items-center justify-center rounded-full border-[0.5px] px-4 text-sub font-semibold",
        "transition-colors duration-fast motion-reduce:transition-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        pressed ? "border-transparent bg-blue-tint text-blue" : "border-hair bg-surface text-ink-2 hover:bg-surface-2",
        className,
      )}>
      {label}
    </button>
  );
}
