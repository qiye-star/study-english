import { useEffect, useRef } from "react";

/**
 * 哨兵进入视口(提前 240px)时调用 onNear(计划 R-17③)。滚动容器是应用壳的 <main>,IntersectionObserver 的 root 取默认视口即可。
 * 没有 IntersectionObserver 的环境什么都不做;「加载更多」按钮始终是兜底。
 */
export function useNearEnd(onNear: () => void, enabled: boolean) {
  const ref = useRef<HTMLDivElement | null>(null);
  const callback = useRef(onNear);
  callback.current = onNear;
  useEffect(() => {
    const el = ref.current;
    if (!enabled || !el || typeof IntersectionObserver === "undefined") return;
    const observer = new IntersectionObserver((hits) => {
      if (hits.some((h) => h.isIntersecting)) callback.current();
    }, { rootMargin: "240px 0px" });
    observer.observe(el);
    return () => observer.disconnect();
  }, [enabled]);
  return ref;
}
