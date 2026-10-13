import { cn } from "@renderer/lib/utils";

/** 列表底部渐进模糊(GradualBlur):一层带遮罩的 backdrop-filter,文字滑入控制胶囊时自然淡出;点击穿透,算一层模糊(R-L26)。 */
export function GradualBlur({ className }: { className?: string }) {
  return <div aria-hidden className={cn("lib-gblur", className)} />;
}
