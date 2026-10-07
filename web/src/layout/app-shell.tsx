import { useState } from "react";
import { Outlet } from "react-router-dom";
import { ScrollRootProvider } from "~/components/glass-top-bar";
import { LookupLayer } from "~/features/lookup/lookup-layer";
import { BottomNav } from "./bottom-nav";
import { useAppHeight } from "./use-app-height";

/**
 * 应用壳:<main> 是唯一滚动区,通过 ScrollRootProvider 交给 PageHeader 判断是否已滚动;
 * 玻璃底栏浮在其上,main 底部留出底栏高度,内容从玻璃下穿过。
 */
export function AppShell() {
  useAppHeight();
  const [scrollRoot, setScrollRoot] = useState<HTMLElement | null>(null);
  return (
    <div className="relative flex flex-col bg-background" style={{ height: "var(--app-height, 100dvh)" }}>
      <ScrollRootProvider value={scrollRoot}>
        <main
          ref={setScrollRoot}
          className="flex min-h-0 flex-1 flex-col overflow-y-auto overscroll-contain pb-[calc(3.5rem+env(safe-area-inset-bottom))]"
        >
          <Outlet />
        </main>
      </ScrollRootProvider>
      <BottomNav />
      <LookupLayer />
    </div>
  );
}
