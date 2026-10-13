import type { HTMLAttributes } from "react";
import { cn } from "@renderer/lib/utils";
import { SoftAurora } from "./fx/soft-aurora";
import "./library.css";

/**
 * 跟读库页面的根(R-L27):`.library-root` 是库内 CSS 变量的作用域(深浅色跟随 html.dark),`.lib-page` 给页面底色并延伸到全站底栏下面,
 * 极光在内容后面。只由懒块里的页面使用(library.css 随懒块进入,不进主包)。播放器再加 `lib-player`。
 */
export function LibraryRoot({ aurora = true, className, children, ...rest }: HTMLAttributes<HTMLDivElement> & { aurora?: boolean }) {
  return (
    <div className={cn("library-root lib-page", className)} {...rest}>
      {aurora ? <SoftAurora /> : null}
      <div className="lib-content">{children}</div>
    </div>
  );
}
