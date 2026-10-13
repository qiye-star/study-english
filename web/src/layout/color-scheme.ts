import { useEffect, useSyncExternalStore } from "react";
import { DEFAULT_COLOR_SCHEME, readStoredColorScheme, type ColorScheme } from "~/settings/color-scheme-pref";

/**
 * 暗色模式沿用桌面端的 .dark 主题变量。外观偏好(spec D12):system = 跟随系统(默认),light / dark = 固定。
 * 偏好是模块级的:系统主题变化的监听用的是「当前」偏好,而不是 init 时的快照。
 */
const DARK_QUERY = "(prefers-color-scheme: dark)";
/** 与 web/index.html 的两条 theme-color 一致 */
const THEME_COLOR = { light: "#ffffff", dark: "#0F1013" } as const;

let preference: ColorScheme = DEFAULT_COLOR_SCHEME;

export function resolveDark(scheme: ColorScheme, systemDark: boolean): boolean {
  return scheme === "dark" || (scheme === "system" && systemDark);
}

/**
 * index.html 的两条 theme-color 带 media,固定为浅 / 深时系统主题与之相反就会染错状态栏:
 * 固定时让两条都给同一个颜色并去掉 media,回到「跟随系统」时还原(原值存在 data-enjoy-original)。
 * iOS 主屏应用的状态栏 / 地址栏表现未在真机验证。
 */
function syncThemeColor(doc: Document, scheme: ColorScheme, dark: boolean): void {
  doc.querySelectorAll("meta[name='theme-color']").forEach((meta) => {
    if (!meta.hasAttribute("data-enjoy-original")) {
      meta.setAttribute("data-enjoy-original", JSON.stringify({ content: meta.getAttribute("content"), media: meta.getAttribute("media") }));
    }
    const original = JSON.parse(meta.getAttribute("data-enjoy-original") ?? "{}") as { content?: string | null; media?: string | null };
    if (scheme === "system") {
      if (original.content != null) meta.setAttribute("content", original.content);
      if (original.media != null) meta.setAttribute("media", original.media);
      else meta.removeAttribute("media");
    } else {
      meta.setAttribute("content", dark ? THEME_COLOR.dark : THEME_COLOR.light);
      meta.removeAttribute("media");
    }
  });
}

/** 把偏好应用到 html:.dark 类、原生控件的 color-scheme、theme-color。 */
export function applyColorScheme(scheme: ColorScheme, win: Window = window): void {
  preference = scheme;
  const systemDark = !!win.matchMedia?.(DARK_QUERY).matches;
  const dark = resolveDark(scheme, systemDark);
  const root = win.document.documentElement;
  root.classList.toggle("dark", dark);
  root.style.setProperty("color-scheme", scheme === "system" ? "" : dark ? "dark" : "light");
  syncThemeColor(win.document, scheme, dark);
}

/** main.tsx 渲染前调用:读存储里的偏好并应用,同时监听系统主题变化。返回清理函数。 */
export function initColorScheme(win: Window = window, scheme: ColorScheme = readStoredColorScheme()): () => void {
  const query = win.matchMedia ? win.matchMedia(DARK_QUERY) : null;
  applyColorScheme(scheme, win);
  const onChange = () => applyColorScheme(preference, win);
  query?.addEventListener?.("change", onChange);
  return () => query?.removeEventListener?.("change", onChange);
}

/** 偏好变了就重新应用(由 ColorSchemeSync 在 SettingsProvider 里调用)。 */
export function useApplyColorScheme(scheme: ColorScheme): void {
  useEffect(() => {
    applyColorScheme(scheme);
  }, [scheme]);
}

function subscribeDarkClass(onChange: () => void): () => void {
  const observer = new MutationObserver(onChange);
  observer.observe(document.documentElement, { attributes: true, attributeFilter: ["class"] });
  return () => observer.disconnect();
}

/** 跟随 html.dark(由 applyColorScheme 维护),供 Toaster 等第三方组件使用。 */
export function useIsDark(): boolean {
  return useSyncExternalStore(
    subscribeDarkClass,
    () => document.documentElement.classList.contains("dark"),
    () => false,
  );
}
