import { useSyncExternalStore } from "react";

/**
 * Liquid-glass attribute (plan 2026-10-15-liquid-glass, INDEX §4.1; on for everyone since L12).
 * <html data-glass="v2"> = new skin; "pin" = a locked route (library, changelog) keeps the classic skin;
 * absent = only before main.tsx ran (tests). The old development switch is gone.
 */
export const GLASS_ATTR = "data-glass";
export const PINNED_PATH_PREFIXES = ["/library", "/practice/changelog"] as const;

/** main.tsx, before render: the liquid skin is on for everyone (L12); removes the old development switch. */
export function initGlassFlag(win: Window = window): boolean {
  try {
    win.localStorage.removeItem("enjoy-web.dev.glass");
  } catch {
    /* storage unavailable: nothing to clean */
  }
  win.document.documentElement.setAttribute(GLASS_ATTR, "v2");
  return true;
}

export function isPinnedPath(pathname: string): boolean {
  return PINNED_PATH_PREFIXES.some((p) => pathname === p || pathname.startsWith(`${p}/`));
}

/** "v2" <-> "pin" while the switch is on; does nothing when it is off. */
export function setGlassPinned(pinned: boolean, doc: Document = document): void {
  const root = doc.documentElement;
  if (!root.hasAttribute(GLASS_ATTR)) return;
  const next = pinned ? "pin" : "v2";
  if (root.getAttribute(GLASS_ATTR) !== next) root.setAttribute(GLASS_ATTR, next);
}

export const isGlassOn = (doc: Document = document): boolean => doc.documentElement.hasAttribute(GLASS_ATTR);
export const isLiquid = (doc: Document = document): boolean => doc.documentElement.getAttribute(GLASS_ATTR) === "v2";

function subscribe(onChange: () => void): () => void {
  const observer = new MutationObserver(onChange);
  observer.observe(document.documentElement, { attributes: true, attributeFilter: [GLASS_ATTR] });
  return () => observer.disconnect();
}

/** True while the new skin applies to the current route (R-LG2 structure branches). */
export function useLiquid(): boolean {
  return useSyncExternalStore(subscribe, () => isLiquid(), () => false);
}
