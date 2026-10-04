import { useSyncExternalStore } from "react";

/** 暗色模式沿用桌面端的 .dark 主题变量,跟随系统设置。 */
export function initColorScheme(win: Window = window): () => void {
  const query = win.matchMedia ? win.matchMedia("(prefers-color-scheme: dark)") : null;
  const apply = () => win.document.documentElement.classList.toggle("dark", !!query?.matches);
  apply();
  query?.addEventListener?.("change", apply);
  return () => query?.removeEventListener?.("change", apply);
}

function subscribeDarkClass(onChange: () => void): () => void {
  const observer = new MutationObserver(onChange);
  observer.observe(document.documentElement, { attributes: true, attributeFilter: ["class"] });
  return () => observer.disconnect();
}

/** 跟随 html.dark(由 initColorScheme 维护),供 Toaster 等第三方组件使用。 */
export function useIsDark(): boolean {
  return useSyncExternalStore(
    subscribeDarkClass,
    () => document.documentElement.classList.contains("dark"),
    () => false,
  );
}
