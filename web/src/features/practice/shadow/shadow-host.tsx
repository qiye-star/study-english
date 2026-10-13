import { lazy, Suspense, useEffect, useRef } from "react";
import { useLocation } from "react-router-dom";
import type { RecorderEnv } from "~/audio/recorder";
import { useShadowHost } from "./shadow-context";

// 弹窗本体、结果、效果、分词、文案、样式都在这个块里,第一次打开才下载(R-S09;shadow-lazy.test.ts 守着)
const LazySheet = lazy(async () => ({ default: (await import("./shadow-sheet")).ShadowSheet }));

/** 与 LookupLayer 并列挂在应用壳里。路径变化(含浏览器返回)时关闭弹窗。 */
export function ShadowSheetHost({ recorderEnv }: { recorderEnv?: RecorderEnv }) {
  const { request, api } = useShadowHost();
  const { pathname } = useLocation();
  const shownAt = useRef(pathname);
  useEffect(() => {
    if (pathname === shownAt.current) return;
    shownAt.current = pathname;
    api?.close();
  }, [pathname, api]);
  if (!request || !api) return null;
  return (
    <Suspense fallback={null}>
      <LazySheet key={request.id} request={request} onClose={api.close} recorderEnv={recorderEnv} />
    </Suspense>
  );
}
