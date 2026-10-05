import { useSyncExternalStore } from "react";
import { readJson, removeKey, writeJson } from "./storage";

/** 全局朗读语速(设计文档 §3.6,计划裁定 R8):同一份合成音频按 playbackRate 播放,不重新合成。 */
export const PLAYBACK_RATES = [0.75, 1, 1.25] as const;
export type PlaybackRate = (typeof PLAYBACK_RATES)[number];
export const PLAYBACK_RATE_KEY = "enjoy-web.playback.rate";

const isRate = (value: unknown): value is PlaybackRate => (PLAYBACK_RATES as readonly unknown[]).includes(value);

let current: PlaybackRate | null = null;
const listeners = new Set<() => void>();
const tracked = new Map<HTMLMediaElement, number>();

export function getPlaybackRate(): PlaybackRate {
  current ??= readJson(PLAYBACK_RATE_KEY, isRate) ?? 1;
  return current;
}

export function applyPlaybackRate(el: HTMLMediaElement, rate: PlaybackRate = getPlaybackRate()): void {
  try {
    const m = el as HTMLMediaElement & { preservesPitch?: boolean; webkitPreservesPitch?: boolean; mozPreservesPitch?: boolean };
    m.preservesPitch = true;
    m.webkitPreservesPitch = true;
    m.mozPreservesPitch = true;
    // 换 src 触发的 load 会把 playbackRate 重置为 defaultPlaybackRate,两个都要设
    el.defaultPlaybackRate = rate;
    el.playbackRate = rate;
  } catch {
    /* 浏览器不支持该倍速:保持原速 */
  }
}

function publish(rate: PlaybackRate): void {
  current = rate;
  for (const el of tracked.keys()) applyPlaybackRate(el, rate);
  for (const listener of [...listeners]) listener();
}

export function setPlaybackRate(rate: PlaybackRate): void {
  if (!isRate(rate)) return;
  writeJson(PLAYBACK_RATE_KEY, rate); // 存储失败(隐私模式)时本页仍生效
  publish(rate);
}

/** 退出登录(clearDeviceData)时调用:删除本机偏好并回到 1×。 */
export function resetPlaybackRate(): void {
  removeKey(PLAYBACK_RATE_KEY);
  publish(1);
}

export function nextPlaybackRate(rate: PlaybackRate): PlaybackRate {
  const at = PLAYBACK_RATES.indexOf(rate);
  return PLAYBACK_RATES[(at + 1) % PLAYBACK_RATES.length];
}

export const formatPlaybackRate = (rate: number) => `${rate}×`;

/** 播放器创建 <audio> 时登记;改语速时立即作用于所有已登记元素(播放中立即生效)。返回幂等的注销函数。 */
export function trackMediaElement(el: HTMLMediaElement): () => void {
  tracked.set(el, (tracked.get(el) ?? 0) + 1);
  applyPlaybackRate(el);
  let done = false;
  return () => {
    if (done) return;
    done = true;
    const left = (tracked.get(el) ?? 1) - 1;
    if (left <= 0) tracked.delete(el);
    else tracked.set(el, left);
  };
}

export function subscribePlaybackRate(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function usePlaybackRate(): PlaybackRate {
  return useSyncExternalStore(subscribePlaybackRate, getPlaybackRate, getPlaybackRate);
}

export function resetPlaybackRateForTests(): void {
  current = null;
  tracked.clear();
}
