import { useMemo, useSyncExternalStore } from "react";
import {
  parseGlassTheme, withBg, withPatch, withPreset,
  type BgPref, type ColorMode, type GlassPatch, type GlassPreset, type GlassTheme,
} from "~/lib/glass-theme";
import { GLASS_THEME_KEY, readJson, removeKey, writeJson } from "~/lib/storage";

/**
 * 「主题自定义」的本机存储(计划 2026-10-15-liquid-glass INDEX §4.3):内存里一份 GlassTheme,变化立即通知
 * (layout/glass-theme.ts 在下一帧写 CSS 变量),持久化在最后一次变化 300 ms 后。拖动滑块时传 persist:false,松手再存。
 */
const isObject = (v: unknown): v is object => typeof v === "object" && v !== null;
const PERSIST_MS = 300;

let current: GlassTheme | null = null;
let timer: ReturnType<typeof setTimeout> | null = null;
const listeners = new Set<() => void>();

const notify = () => listeners.forEach((l) => l());

export function getGlassTheme(): GlassTheme {
  if (!current) current = parseGlassTheme(readJson(GLASS_THEME_KEY, isObject));
  return current;
}

export function setGlassTheme(next: GlassTheme, opts: { persist?: boolean } = {}): void {
  current = next;
  notify();
  if (opts.persist === false) return;
  if (timer) clearTimeout(timer);
  timer = setTimeout(() => {
    timer = null;
    if (current) writeJson(GLASS_THEME_KEY, current);
  }, PERSIST_MS);
}

export function subscribeGlassTheme(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** 登出(auth/device-data)或测试:丢掉内存副本与待写入,下次从存储重新读,并通知订阅者重新应用。 */
export function resetGlassThemeMemory(): void {
  if (timer) clearTimeout(timer);
  timer = null;
  current = null;
  notify();
}

export interface GlassThemeApi {
  theme: GlassTheme;
  update(patch: GlassPatch, opts?: { persist?: boolean }): void;
  updateBg(mode: ColorMode, patch: Partial<BgPref>, opts?: { persist?: boolean }): void;
  applyPreset(preset: Exclude<GlassPreset, "custom">): void;
  reset(): void;
}

export function useGlassTheme(): GlassThemeApi {
  const theme = useSyncExternalStore(subscribeGlassTheme, getGlassTheme, getGlassTheme);
  return useMemo(() => ({
    theme,
    update: (patch, opts) => setGlassTheme(withPatch(getGlassTheme(), patch), opts),
    updateBg: (mode, patch, opts) => setGlassTheme(withBg(getGlassTheme(), mode, patch), opts),
    applyPreset: (preset) => setGlassTheme(withPreset(getGlassTheme(), preset)),
    reset: () => {
      if (timer) clearTimeout(timer);
      timer = null;
      removeKey(GLASS_THEME_KEY);
      current = parseGlassTheme(null);
      notify();
    },
  }), [theme]);
}
