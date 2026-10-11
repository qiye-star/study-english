import { lazy, Suspense } from "react";

const Page = lazy(() => import("./memory-page").then((m) => ({ default: m.MemoryPage })));

/** 记忆页按路由懒加载(spec §3.4、R-A2):主包里只有这个包装(越短越好,预算 0.2 kB)。 */
export const MemoryPage = () => (
  <Suspense fallback={<div aria-busy="true" />}>
    <Page />
  </Suspense>
);
