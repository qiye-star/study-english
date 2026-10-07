import type { ReactNode } from "react";
import { cn } from "@renderer/lib/utils";

/** 底部导航高度(不含 safe-area),AppShell 用它给滚动区留出底部空间。 */
export const TAB_BAR_HEIGHT = "3.5rem";

/**
 * 常驻玻璃底栏:固定在父容器底部(absolute),顶部发丝线,底部 safe-area 内边距,行高 56px。
 * 内容从其下穿过,所以父级滚动区需要 pb-[calc(3.5rem+env(safe-area-inset-bottom))]。
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
      className={cn("glass glass-edge-t absolute inset-x-0 bottom-0 z-30 pb-[env(safe-area-inset-bottom)]", className)}
    >
      <ul className="grid h-14" style={{ gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))` }}>
        {children}
      </ul>
    </nav>
  );
}

/** 底栏项的类名:≥56px 目标,24px 图标 + 11px 标签;激活为蓝色 600。用于 NavLink 的 className 回调。 */
export function tabBarItemClass(isActive: boolean): string {
  return cn(
    "flex h-full min-h-14 flex-col items-center justify-center gap-0.5 text-label tracking-[0.01em] transition-colors duration-fast",
    "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring [&_svg]:h-6 [&_svg]:w-6",
    isActive ? "font-semibold text-blue" : "font-medium text-ink-2",
  );
}
