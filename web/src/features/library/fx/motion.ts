/**
 * 库内动效的开关与帧源(spec §11.4a、R-L28)。CSS 动画靠 library.css 末尾的降级段;用 JS 驱动的效果
 * (CountUp、BlurText、ClickSpark)在这里判断,并可注入假的帧源做测试。
 */
export interface FrameSource {
  request(cb: (now: number) => void): number;
  cancel(id: number): void;
  now(): number;
}

export const browserFrames: FrameSource = {
  request: (cb) => window.requestAnimationFrame(cb),
  cancel: (id) => window.cancelAnimationFrame(id),
  now: () => performance.now(),
};

/** 低端机(html.lite)或系统开了「减少动态效果」时为 false:JS 驱动的效果直接给终态,不动画。 */
export function motionAllowed(win: Window = window): boolean {
  if (win.document.documentElement.classList.contains("lite")) return false;
  try {
    return !win.matchMedia("(prefers-reduced-motion: reduce)").matches;
  } catch {
    return true;
  }
}
