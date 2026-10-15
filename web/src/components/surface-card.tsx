import type { ElementType, HTMLAttributes } from "react";
import { cn } from "@renderer/lib/utils";
import { LQ_PANEL, LQ_PANEL_STRONG } from "./liquid";

/**
 * 实底卡片:surface 底、0.5px 发丝线、14px 圆角、亮色下极淡投影。内边距由调用方给(通常 p-3.5)。
 * 液态皮肤(计划 2026-10-15-liquid-glass):E1 分区 .m1(strong = 英雄面板 .m1.strong),圆角 26 × 圆角倍数;永不模糊。
 *   <SurfaceCard className="p-3.5">…</SurfaceCard> · <SurfaceCard as="section" aria-label="…"> · <SurfaceCard strong>
 */
export function SurfaceCard({
  as: Tag = "div",
  strong = false,
  className,
  ...rest
}: HTMLAttributes<HTMLElement> & { as?: ElementType; strong?: boolean }) {
  return (
    <Tag
      className={cn("rounded-card border-[0.5px] border-hair bg-surface shadow-card dark:shadow-none", strong ? LQ_PANEL_STRONG : LQ_PANEL, className)}
      {...rest}
    />
  );
}
