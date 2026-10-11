import { lazy, Suspense } from "react";

const Page = lazy(async () => ({ default: (await import("./memory-page")).MemoryPage }));

/** 记忆页按路由懒加载(spec §3.4、R-A2):主包里只有这个包装。 */
export function MemoryPage() {
  return (
    <Suspense fallback={<div aria-busy="true" className="min-h-[50vh]" />}>
      <Page />
    </Suspense>
  );
}
