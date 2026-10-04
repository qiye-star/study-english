import { useEffect } from "react";

/** iOS 键盘弹出时 visualViewport 变矮;把它写进 --app-height,让输入栏始终可见。 */
export function useAppHeight(win: Window = window): void {
  useEffect(() => {
    const viewport = win.visualViewport;
    const apply = () => {
      const height = Math.round(viewport ? viewport.height : win.innerHeight);
      win.document.documentElement.style.setProperty("--app-height", `${height}px`);
    };
    apply();
    viewport?.addEventListener("resize", apply);
    win.addEventListener("resize", apply);
    return () => {
      viewport?.removeEventListener("resize", apply);
      win.removeEventListener("resize", apply);
    };
  }, [win]);
}
