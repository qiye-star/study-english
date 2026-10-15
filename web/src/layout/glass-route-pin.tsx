import { useLayoutEffect } from "react";
import { useLocation } from "react-router-dom";
import { isPinnedPath, setGlassPinned } from "~/lib/glass-flag";

/** Locked routes (library, changelog) keep the classic skin of shared components (plan 2026-10-15-liquid-glass R-LG3). */
export function GlassRoutePin(): null {
  const { pathname } = useLocation();
  useLayoutEffect(() => {
    setGlassPinned(isPinnedPath(pathname));
  }, [pathname]);
  useLayoutEffect(() => () => setGlassPinned(false), []);
  return null;
}
