import type { HTMLAttributes } from "react";
import { cn } from "@renderer/lib/utils";

/** 处理中的文字流光(ShinyText):`background-clip: text` + 流光渐变;不支持时是普通次要色文字(library.css 的 @supports 守卫)。 */
export function ShinyText({ className, ...rest }: HTMLAttributes<HTMLSpanElement>) {
  return <span className={cn("lib-shiny", className)} {...rest} />;
}
