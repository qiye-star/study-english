import type { ReactNode } from "react";
import { cn } from "@renderer/lib/utils";

/**
 * 底栏占的空间(胶囊高 + 下沿 + 与上方内容的间距,含安全区),定义在 index.css 的 :root(计划 2026-10-14-floating-glass-bottom-bar R-F5)。
 * 滚动区留白、跟读库浮层、选词操作条都读这一个变量,不在页面里写数值。
 */
export const TAB_BAR_SPACE = "var(--tab-bar-space)";

/**
 * 常驻悬浮玻璃底栏(R-F2):离开屏幕左右 12px、下沿 --tab-bar-bottom(让开 Home 横条)、圆角 28、高 64(1px 描边 + 3px 内边距 + 56px 行),
 * 近乎透明的 .glass-float(index.css,含回退)。内容从其下穿过,所以父级滚动区需要 pb-[var(--tab-bar-space)]。
 * 本元素不做动画(design-notes:不对模糊元素本身做动画)。
 *   <GlassTabBar label={t("web.nav.label")} columns={3}>{items}</GlassTabBar>
 */
export function GlassTabBar({
  label,
  columns,
  className,
  children,
}: {
  label: string;
  columns: number;
  className?: string;
  children: ReactNode;
}) {
  return (
    <nav
      aria-label={label}
      className={cn(
        "glass-float absolute inset-x-3 bottom-[var(--tab-bar-bottom)] z-30 mx-auto h-16 max-w-screen-sm rounded-dock p-[3px]",
        className,
      )}
    >
      <ul className="grid h-14" style={{ gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))` }}>
        {children}
      </ul>
    </nav>
  );
}

/**
 * 底栏项的类名:≥56px 目标,24px 图标 + 11px 标签,标签与图标带光晕 .tab-halo(R-F4:近乎透明的底栏上,对比度靠光晕保证);
 * 激活为蓝色 600 + 同心小胶囊底(圆角 24 = 28 − 3 − 1)。用于 NavLink 的 className 回调。
 */
export function tabBarItemClass(isActive: boolean): string {
  return cn(
    "tab-halo flex h-full min-h-14 flex-col items-center justify-center gap-0.5 rounded-[24px] text-label tracking-[0.01em] transition-colors duration-fast",
    "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring [&_svg]:h-6 [&_svg]:w-6",
    isActive ? "bg-[var(--tab-on)] font-semibold text-blue" : "font-medium text-ink-2",
  );
}
