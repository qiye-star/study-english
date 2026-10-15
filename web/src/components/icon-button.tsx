import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from "react";
import { cn } from "@renderer/lib/utils";

/**
 * 44×44 图标按钮(顶栏、输入条)。label 必填,作为 aria-label。tone="blue" 用于主操作(如通话),
 * dot 在右上角显示蓝色状态点(如自动朗读已开)。图标建议 h-[22px] w-[22px]。
 *   <IconButton label={t("web.common.back")} onClick={…}><ChevronLeftIcon className="h-[22px] w-[22px]" /></IconButton>
 */
export const IconButton = forwardRef<
  HTMLButtonElement,
  Omit<ButtonHTMLAttributes<HTMLButtonElement>, "aria-label"> & {
    label: string;
    tone?: "ink" | "blue";
    dot?: boolean;
    children: ReactNode;
  }
>(function IconButton({ label, tone = "ink", dot = false, className, children, type = "button", ...rest }, ref) {
  return (
    <button
      ref={ref}
      type={type}
      aria-label={label}
      className={cn(
        "relative inline-flex h-tap w-tap flex-none items-center justify-center rounded-button transition-colors duration-fast liquid:rounded-full liquid:hover:bg-wash",
        "hover:bg-surface-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50",
        "[&_svg]:h-[22px] [&_svg]:w-[22px]",
        tone === "blue" ? "text-blue" : "text-ink",
        className,
      )}
      {...rest}
    >
      {children}
      {dot ? (
        <span data-dot aria-hidden className="absolute right-[9px] top-[9px] h-[7px] w-[7px] rounded-full bg-blue shadow-[0_0_0_2px_rgb(var(--bg))]" />
      ) : null}
    </button>
  );
});
