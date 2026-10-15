import { useSyncExternalStore } from "react";

/**
 * Liquid-glass switch (plan 2026-10-15-liquid-glass, INDEX §4.1).
 * <html data-glass="v2"> = new skin; "pin" = switch on but a locked route (library, changelog) keeps the classic skin;
 * absent = classic. The dev switch is read once before the first render (main.tsx). GLASS_FLAG_KEY goes away in L12.
 */
export const GLASS_ATTR = "data-glass";
export const GLASS_FLAG_KEY = "enjoy-web.dev.glass";
export const PINNED_PATH_PREFIXES = ["/library", "/practice/changelog"] as const;

/** ?glass=v2 remembers the switch on this device, ?glass=off forgets it; then reads it. Storage errors → URL only. */
export function readGlassFlag(win: Window = window): boolean {
  let param: string | null = null;
  try {
    param = new URLSearchParams(win.location.search).get("glass");
  } catch {
    param = null;
  }
  try {
    if (param === "v2") win.localStorage.setItem(GLASS_FLAG_KEY, "v2");
    else if (param === "off") win.localStorage.removeItem(GLASS_FLAG_KEY);
    return win.localStorage.getItem(GLASS_FLAG_KEY) === "v2";
  } catch {
    return param === "v2";
  }
}

/** main.tsx, before render: sets or removes data-glass="v2" on <html>. */
export function initGlassFlag(win: Window = window): boolean {
  const on = readGlassFlag(win);
  const root = win.document.documentElement;
  if (on) root.setAttribute(GLASS_ATTR, "v2");
  else root.removeAttribute(GLASS_ATTR);
  return on;
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
