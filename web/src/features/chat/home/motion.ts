import { useEffect, useState } from "react";

/*
 * 动画约定(网页计划 FR13):手写 CSS + Web Animations API,零依赖。所有 `el.animate` 都经 `animate()`:
 * 没有 `Element.animate`(jsdom)或要求减弱动效时直接跳到终态并同步调用 onfinish。
 */
const QUERY = "(prefers-reduced-motion: reduce)";

export function prefersReducedMotion(): boolean {
  try {
    return window.matchMedia(QUERY).matches;
  } catch {
    return false;
  }
}

/** 随系统设置变化的减弱动效标记。 */
export function useReducedMotion(): boolean {
  const [reduced, setReduced] = useState(prefersReducedMotion);
  useEffect(() => {
    let list: MediaQueryList;
    try {
      list = window.matchMedia(QUERY);
    } catch {
      return;
    }
    const onChange = () => setReduced(list.matches);
    onChange();
    list.addEventListener?.("change", onChange);
    return () => list.removeEventListener?.("change", onChange);
  }, []);
  return reduced;
}

export interface AnimateOptions extends KeyframeAnimationOptions {
  /** 为 true 时不播放,直接到终态(调用方传 useReducedMotion() 的值)。 */
  skip?: boolean;
  onfinish?: () => void;
}

/** 播放关键帧;不可播放时同步调用 onfinish 并返回 null。 */
export function animate(el: Element, keyframes: Keyframe[], { skip, onfinish, ...options }: AnimateOptions = {}): Animation | null {
  if (skip || typeof el.animate !== "function") {
    onfinish?.();
    return null;
  }
  const animation = el.animate(keyframes, options);
  if (onfinish) animation.onfinish = onfinish;
  return animation;
}
