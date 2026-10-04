/** 暗色模式沿用桌面端的 .dark 主题变量,跟随系统设置。 */
export function initColorScheme(win: Window = window): () => void {
  const query = win.matchMedia ? win.matchMedia("(prefers-color-scheme: dark)") : null;
  const apply = () => win.document.documentElement.classList.toggle("dark", !!query?.matches);
  apply();
  query?.addEventListener?.("change", apply);
  return () => query?.removeEventListener?.("change", apply);
}
