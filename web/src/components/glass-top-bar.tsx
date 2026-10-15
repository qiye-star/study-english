import { createContext, useContext, useEffect, useState, type ReactNode, type RefObject } from "react";
import { cn } from "@renderer/lib/utils";
import { useLiquid } from "~/lib/glass-flag";

/** 应用壳的滚动容器(AppShell 的 <main>)。顶栏据此决定静止透明 / 滚动后玻璃。 */
const ScrollRootContext = createContext<HTMLElement | null>(null);
export const ScrollRootProvider = ScrollRootContext.Provider;
export function useScrollRoot(): HTMLElement | null {
  return useContext(ScrollRootContext);
}

function isRef<T>(target: T | null | RefObject<T | null>): target is RefObject<T | null> {
  return target !== null && typeof target === "object" && "current" in target;
}

/** scrollTop > threshold(默认 4px)时为 true。target 可以是元素或 ref。 */
export function useScrolled(target: HTMLElement | null | RefObject<HTMLElement | null>, threshold = 4): boolean {
  const [scrolled, setScrolled] = useState(false);
  useEffect(() => {
    const el = isRef(target) ? target.current : target;
    if (!el) {
      setScrolled(false);
      return;
    }
    const update = () => setScrolled(el.scrollTop > threshold);
    update();
    el.addEventListener("scroll", update, { passive: true });
    return () => el.removeEventListener("scroll", update);
  }, [target, threshold]);
  return scrolled;
}

/**
 * 顶栏:静止时透明无线;scrolled 时变玻璃(.glass-bar,含底部发丝线)。自带 safe-area 顶部内边距,
 * 栏高 52px,标题 17px,可选 12px 副标题。leading 通常是返回 IconButton,actions 是右侧 IconButton。
 * 默认 sticky top-0;页面需要其它定位时通过 className 覆盖。
 * 液态皮肤(计划 2026-10-15-liquid-glass R-L2-4):悬浮标题胶囊,见 floating。
 *   <GlassTopBar title="练习" subtitle="周三 · 10 月 8 日" scrolled={useScrolled(useScrollRoot())} actions={…} />
 */
export function GlassTopBar({
  title,
  subtitle,
  leading,
  actions,
  scrolled,
  className,
  children,
  floating = "always",
}: {
  title?: ReactNode;
  subtitle?: ReactNode;
  leading?: ReactNode;
  actions?: ReactNode;
  scrolled: boolean;
  className?: string;
  /** 替代标题区的自定义内容 */
  children?: ReactNode;
  /** 液态皮肤:"always" = 子页面胶囊常驻(滚动 4px 后变玻璃);"scrolled" = 根页面,滚动后才出现(PageHeader large 用) */
  floating?: "always" | "scrolled";
}) {
  const liquid = useLiquid();
  if (liquid) {
    // 设计稿 .capsule:离边 12、高 44、胶囊;只有标题(≥17px,data-glass-title)与图标(规则 4),副标题只给读屏
    const shown = floating === "always" || scrolled;
    return (
      <header
        data-scrolled={scrolled ? "true" : "false"}
        data-capsule={shown ? "shown" : "hidden"}
        className={cn("pointer-events-none sticky top-0 z-30 px-frame pt-[calc(env(safe-area-inset-top)+4px)]", className)}
      >
        <div
          className={cn(
            "pointer-events-auto flex h-11 items-center gap-1 rounded-full border border-transparent px-0.5 transition-opacity duration-fast ease-standard",
            scrolled && shown && "mat-chrome-bar",
            shown ? "opacity-100" : "invisible opacity-0",
          )}
        >
          {leading ?? <span aria-hidden className="w-tap flex-none" />}
          {children ?? (
            floating === "scrolled"
              ? <span data-glass-title aria-hidden className="min-w-0 flex-1 truncate text-center text-title font-semibold">{title}</span>
              : <h1 data-glass-title className="min-w-0 flex-1 truncate text-center text-title font-semibold">{title}</h1>
          )}
          {actions ?? <span aria-hidden className="w-tap flex-none" />}
          {subtitle ? <span className="sr-only">{subtitle}</span> : null}
        </div>
      </header>
    );
  }
  return (
    <header
      data-scrolled={scrolled ? "true" : "false"}
      className={cn(
        "sticky top-0 z-30 pt-[env(safe-area-inset-top)] transition-[background-color,box-shadow] duration-fast ease-standard",
        scrolled ? "glass-bar" : "bg-transparent",
        className,
      )}
    >
      <div className={cn("flex h-[52px] items-center gap-1", leading ? "px-2" : "pl-4 pr-2")}>
        {leading}
        {children ?? (
          <div className={cn("min-w-0 flex-1", leading && "px-2")}>
            <h1 className="truncate text-title font-semibold">{title}</h1>
            {subtitle ? <p className="mt-px truncate text-meta font-medium text-ink-2">{subtitle}</p> : null}
          </div>
        )}
        {actions}
      </div>
    </header>
  );
}
