import type { ElementType, HTMLAttributes } from "react";
import { cn } from "@renderer/lib/utils";

/**
 * 玻璃面(GlassSurface):模糊 + 饱和 + 内高光边 + 外阴影,样式是 library.css 的 `.lib-glass`。
 * 一屏最多 3 层模糊(R-L26):播放器里只有控制胶囊用它;`strong` = 强面(更不透明)。
 */
export function GlassSurface({ as: Tag = "div", strong = false, className, ...rest }: HTMLAttributes<HTMLElement> & { as?: ElementType; strong?: boolean }) {
  return <Tag className={cn("lib-glass", strong && "lib-glass--strong", className)} {...rest} />;
}
