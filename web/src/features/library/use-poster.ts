import { type RefObject, useEffect, useState } from "react";
import { useAuth } from "~/auth/auth-context";
import { fetchPoster } from "./library-api";

/**
 * 视频封面(R-L18):`<img>` 发不了 Bearer,所以用 ApiClient 取 blob 再 createObjectURL;给了 target 且有
 * IntersectionObserver 时,进入视口(提前 200px)才取;卸载或换条目时撤销 URL。失败 = 没有封面(显示图标)。
 */
export function usePosterUrl(itemId: string, enabled: boolean, target?: RefObject<Element | null>): string | null {
  const { api } = useAuth();
  const [url, setUrl] = useState<string | null>(null);
  const [visible, setVisible] = useState(!target);

  useEffect(() => {
    if (!enabled || visible) return;
    const el = target?.current;
    if (!el || typeof IntersectionObserver === "undefined") {
      setVisible(true);
      return;
    }
    const io = new IntersectionObserver((entries) => {
      if (entries.some((e) => e.isIntersecting)) {
        setVisible(true);
        io.disconnect();
      }
    }, { rootMargin: "200px" });
    io.observe(el);
    return () => io.disconnect();
  }, [enabled, visible, target]);

  useEffect(() => {
    if (!enabled || !visible || !itemId || typeof URL.createObjectURL !== "function") return;
    const ctl = new AbortController();
    let made: string | null = null;
    fetchPoster(api, itemId, ctl.signal).then((blob) => {
      if (ctl.signal.aborted) return;
      made = URL.createObjectURL(blob);
      setUrl(made);
    }, () => { /* 没有封面就显示图标 */ });
    return () => {
      ctl.abort();
      if (made) URL.revokeObjectURL(made);
      setUrl(null);
    };
  }, [api, itemId, enabled, visible]);

  return url;
}
