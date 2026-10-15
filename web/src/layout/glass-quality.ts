/**
 * 低内存设备(navigator.deviceMemory ≤ 4)给 <html> 加 .lite:index.css 里的 .glass* 改用更轻的 blur(12px) 与更高不透明度。
 * 不支持 deviceMemory 的浏览器(Safari)保持完整玻璃。液态玻璃打开时,layout/glass-theme.ts 还会因用户选了「减弱」而加 .lite。
 */
export function isLowMemory(win: Window = window): boolean {
  const memory = (win.navigator as Navigator & { deviceMemory?: number }).deviceMemory;
  return typeof memory === "number" && memory <= 4;
}

export function initGlassQuality(win: Window = window): boolean {
  const lite = isLowMemory(win);
  win.document.documentElement.classList.toggle("lite", lite);
  return lite;
}
