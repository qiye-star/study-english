import { EyeIcon } from "lucide-react";
import { useRef, useState, type ReactNode } from "react";
import { cn } from "~/lib/cn";

export interface ZhDefsCoverProps {
  /** false = 原样返回 children(默认「自动显示」下 DOM 与没有本组件时相同) */
  active: boolean;
  /** 换 key = 换一张卡 / 一次查词:揭开状态复位 */
  resetKey: unknown;
  /** 按钮文字:调用方传已翻译的文字(本组件不含文案,同 ZhToggle / ZhNoteFold) */
  label: string;
  /** 被包块原有的上外边距类(如 mt-3.5),按钮与尺寸层照它留出同样的空隙 */
  offsetClassName?: string;
  /** 追加到按钮上的外观类(查词抽屉传玻璃井令牌) */
  className?: string;
  testId?: string;
  children: ReactNode;
}

const NONE = Symbol("none");

/**
 * 「点击后显示」的原位揭开(计划 2026-10-23 R-A3):三层叠在同一格 —— 中文块、尺寸层、隐藏时的按钮。
 * 格子高度 = max(中文块, 外边距 + 44 px),揭开前后不变;按钮正好占中文块的位置。
 * 隐藏的中文以 visibility:hidden 留在 DOM 里只为占位(不计分、不发请求)。揭开后不再收回,翻到下一张(换 resetKey)才复位。
 */
export function ZhDefsCover({ active, resetKey, label, offsetClassName, className, testId = "zh-defs-cover", children }: ZhDefsCoverProps) {
  const [shownFor, setShownFor] = useState<unknown>(NONE);
  const contentRef = useRef<HTMLDivElement>(null);
  if (!active) return <>{children}</>;
  const shown = shownFor === resetKey;
  return (
    <div data-testid={testId} data-state={shown ? "shown" : "hidden"} className="grid">
      <div ref={contentRef} tabIndex={-1} aria-hidden={shown ? undefined : true}
        style={shown ? undefined : { visibility: "hidden" }}
        className={cn("[grid-area:1/1] focus:outline-none", !shown && "invisible")}>
        {children}
      </div>
      <span aria-hidden data-zh-sizer className={cn("invisible [grid-area:1/1] min-h-tap", offsetClassName)} />
      {!shown && (
        <button type="button" data-testid="zh-defs-reveal" aria-expanded="false"
          onClick={() => {
            setShownFor(resetKey);
            contentRef.current?.focus();
          }}
          className={cn(
            "[grid-area:1/1] inline-flex min-h-tap w-full items-center justify-center gap-1.5 rounded-badge border border-dashed border-hair bg-surface-2 px-3 text-meta font-medium text-ink-2",
            "transition-colors duration-fast hover:bg-surface focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
            offsetClassName,
            className,
          )}>
          <EyeIcon aria-hidden className="size-3.5" />
          {label}
        </button>
      )}
    </div>
  );
}
