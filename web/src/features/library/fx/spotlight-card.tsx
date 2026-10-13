import type { HTMLAttributes, PointerEvent } from "react";
import { cn } from "@renderer/lib/utils";

export function pointerOffset(rect: { left: number; top: number }, clientX: number, clientY: number): { x: number; y: number } {
  return { x: clientX - rect.left, y: clientY - rect.top };
}

/**
 * 卡片(SpotlightCard):按住 / 悬停时高光跟随手指(spec §11.4a)。`pointermove` 只写两个 CSS 变量(--mx / --my),
 * 不触发 React 渲染;按住时给 `data-press`。半透明填充 + 高光边(`.lib-tint`),不加模糊。
 */
export function SpotlightCard({ className, onPointerMove, onPointerDown, onPointerUp, onPointerLeave, onPointerCancel, ...rest }: HTMLAttributes<HTMLDivElement>) {
  const move = (e: PointerEvent<HTMLDivElement>) => {
    const el = e.currentTarget;
    const { x, y } = pointerOffset(el.getBoundingClientRect(), e.clientX, e.clientY);
    el.style.setProperty("--mx", `${x}px`);
    el.style.setProperty("--my", `${y}px`);
  };
  const release = (e: PointerEvent<HTMLDivElement>) => e.currentTarget.removeAttribute("data-press");
  return (
    <div
      className={cn("lib-spot lib-tint", className)}
      onPointerMove={(e) => { move(e); onPointerMove?.(e); }}
      onPointerDown={(e) => { move(e); e.currentTarget.setAttribute("data-press", ""); onPointerDown?.(e); }}
      onPointerUp={(e) => { release(e); onPointerUp?.(e); }}
      onPointerLeave={(e) => { release(e); onPointerLeave?.(e); }}
      onPointerCancel={(e) => { release(e); onPointerCancel?.(e); }}
      {...rest}
    />
  );
}
