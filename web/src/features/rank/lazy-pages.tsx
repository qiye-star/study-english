import { lazy, Suspense } from "react";

const Page = lazy(() => import("./match-page").then((m) => ({ default: m.MatchPage })));

/**
 * 对战页按路由懒加载(与 chat/lazy-pages.tsx、wordbook/lazy-pages.tsx 同法):页面里的底部输入条登记 --dock-space
 * (计划 2026-10-15-lookup-bar-dock-space),那段代码不进主包。测试直接导入 ./match-page。
 */
export function MatchPage() {
  return (
    <Suspense fallback={<div aria-busy="true" className="flex-1" />}>
      <Page />
    </Suspense>
  );
}
