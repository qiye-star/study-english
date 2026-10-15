import { isGlassOn, isLiquid } from "~/lib/glass-flag";
import { computeGlassVars, type ComputedGlass, type GlassTheme, type Rgb } from "~/lib/glass-theme";
import { getGlassTheme, subscribeGlassTheme } from "~/settings/glass-theme-store";
import { setThemeColorOverride } from "./color-scheme";
import { isLowMemory } from "./glass-quality";

const hex = ([r, g, b]: Rgb) => `#${[r, g, b].map((c) => c.toString(16).padStart(2, "0")).join("")}`;

/**
 * 把「主题自定义」写到 <html>(计划 2026-10-15-liquid-glass INDEX §4.3):内联 CSS 变量(--mat-* / --gx-radius / --page-*)、
 * data-bg(渐变 / 颗粒 / 纯色)、.lite(低内存或用户选「减弱」)、以及 theme-color(iOS 状态栏跟随所选背景色,
 * 仅在 data-glass="v2" 时;固定经典外观的路由 / 开关关闭时交还给 color-scheme.ts)。降低透明度由 index.css 的媒体查询处理。
 */
export function applyGlassTheme(theme: GlassTheme, win: Window = window): ComputedGlass {
  const root = win.document.documentElement;
  const lite = isLowMemory(win) || theme.reduced;
  if (root.classList.contains("lite") !== lite) root.classList.toggle("lite", lite);
  const out = computeGlassVars(theme, { dark: root.classList.contains("dark"), lite });
  for (const [name, value] of Object.entries(out.vars)) root.style.setProperty(name, value);
  root.setAttribute("data-bg", theme.bgStyle);
  setThemeColorOverride(isLiquid(win.document) ? hex(theme.bgStyle === "solid" ? out.bg.flat : out.bg.top) : null, win);
  return out;
}

/** main.tsx 渲染前调用;开关关闭时什么也不做。之后跟随存储变化、html.dark 切换与 data-glass 变化(路由 pin),每帧最多写一次。返回清理函数。 */
export function initGlassTheme(win: Window = window): () => void {
  if (!isGlassOn(win.document)) return () => {};
  const raf = win.requestAnimationFrame?.bind(win) ?? ((cb: FrameRequestCallback) => win.setTimeout(() => cb(0), 16));
  const cancel = win.cancelAnimationFrame?.bind(win) ?? ((id: number) => win.clearTimeout(id));
  let frame = 0;
  let pending = false;
  const apply = () => applyGlassTheme(getGlassTheme(), win);
  const schedule = () => {
    if (pending) return;
    pending = true;
    frame = raf(() => {
      pending = false;
      frame = 0;
      apply();
    });
  };
  apply();
  const unsubscribe = subscribeGlassTheme(schedule);
  // .dark 由 color-scheme.ts 切换;我们自己切 .lite 时只在值变化时切,所以不会循环
  const observer = new MutationObserver(schedule);
  observer.observe(win.document.documentElement, { attributes: true, attributeFilter: ["class", "data-glass"] });
  return () => {
    unsubscribe();
    observer.disconnect();
    if (pending && frame) cancel(frame);
    pending = false;
    setThemeColorOverride(null, win);
  };
}
