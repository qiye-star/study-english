import { useSyncExternalStore } from "react";
import { ZH_DEFS_PREF_KEY, readJson, removeKey, writeJson } from "~/lib/storage";

/**
 * 中文释义显示偏好(「我的 → 中文释义」):auto = 自动显示(默认,行为不变);tap = 学新词 / 复习 / 查词结果里
 * 本来会直接显示的中文释义先藏起,点一下再看(外观见 components/zh-defs-cover)。
 * 与服务端的 def_lang(有哪些语言的行)互相独立,计划 2026-10-23 R-A1/R-A2。只存在本机、只存一个枚举值。
 */
export const ZH_DEFS_MODES = ["auto", "tap"] as const;
export type ZhDefsMode = (typeof ZH_DEFS_MODES)[number];
export const DEFAULT_ZH_DEFS_MODE: ZhDefsMode = "auto";

const isTap = (v: unknown): v is "tap" => v === "tap";

// 内存副本:useSyncExternalStore 的快照是字符串,稳定;存储失败时内存里仍然生效
let current: ZhDefsMode | null = null;
const listeners = new Set<() => void>();

/** 读到任何不是 "tap" 的值都当 auto。 */
export function getZhDefsMode(): ZhDefsMode {
  if (current === null) current = readJson(ZH_DEFS_PREF_KEY, isTap) ?? DEFAULT_ZH_DEFS_MODE;
  return current;
}

/** 只在 tap 时写存储;选回 auto 就删键。 */
export function setZhDefsMode(mode: ZhDefsMode): void {
  current = mode;
  if (mode === "tap") writeJson(ZH_DEFS_PREF_KEY, mode);
  else removeKey(ZH_DEFS_PREF_KEY);
  listeners.forEach((listener) => listener());
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** 登出(auth/device-data)或测试:丢掉内存副本,下次从存储重新读。 */
export function resetZhDefsModeMemory(): void {
  current = null;
  listeners.forEach((listener) => listener());
}

export function useZhDefsMode(): ZhDefsMode {
  return useSyncExternalStore(subscribe, getZhDefsMode, getZhDefsMode);
}
