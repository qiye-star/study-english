/**
 * 低内存设备(navigator.deviceMemory ≤ 4)给 <html> 加 .lite:index.css 里的 .glass*
 * 改用更轻的 blur(12px) 与更高不透明度。不支持 deviceMemory 的浏览器(Safari)保持完整玻璃。
 */
export function initGlassQuality(win: Window = window): boolean {
  const memory = (win.navigator as Navigator & { deviceMemory?: number }).deviceMemory;
  const lite = typeof memory === "number" && memory <= 4;
  win.document.documentElement.classList.toggle("lite", lite);
  return lite;
}
