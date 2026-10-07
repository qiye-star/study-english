import type { ElementType, HTMLAttributes } from "react";
import { cn } from "@renderer/lib/utils";

/**
 * 实底卡片:surface 底、0.5px 发丝线、14px 圆角、亮色下极淡投影。内边距由调用方给(通常 p-3.5)。
 *   <SurfaceCard className="p-3.5">…</SurfaceCard> · <SurfaceCard as="section" aria-label="…">
 */
export function SurfaceCard({
  as: Tag = "div",
  className,
  ...rest
}: HTMLAttributes<HTMLElement> & { as?: ElementType }) {
  return (
    <Tag
      className={cn("rounded-card border-[0.5px] border-hair bg-surface shadow-card dark:shadow-none", className)}
      {...rest}
    />
  );
}
