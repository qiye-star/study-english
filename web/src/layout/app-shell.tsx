import { useState } from "react";
import { Outlet } from "react-router-dom";
import { ScrollRootProvider } from "~/components/glass-top-bar";
import { LookupLayer } from "~/features/lookup";
import { ShadowSheetHost, ShadowSheetProvider } from "~/features/practice";
import { BottomNav } from "./bottom-nav";
import { useAppHeight } from "./use-app-height";

/**
 * 应用壳:<main> 是唯一滚动区,通过 ScrollRootProvider 交给 PageHeader 判断是否已滚动;
 * 悬浮玻璃底栏浮在其上,main 底部留出 --tab-bar-space(index.css,计划 2026-10-14-floating-glass-bottom-bar R-F5),内容从玻璃下穿过;
 * DOCK / 输入条 sticky 或 absolute 在 main 的内容框下沿,因此自动停在胶囊上方 8px,不需要各自改。
 * 弹窗(ShadowSheetHost)与查词层并列,Provider 包住整个壳,各页面经 useShadowSheet() 打开。
 */
export function AppShell() {
  useAppHeight();
  const [scrollRoot, setScrollRoot] = useState<HTMLElement | null>(null);
  return (
    <ShadowSheetProvider>
      <div className="relative flex flex-col bg-background" style={{ height: "var(--app-height, 100dvh)" }}>
        <ScrollRootProvider value={scrollRoot}>
          <main
            ref={setScrollRoot}
            className="flex min-h-0 flex-1 flex-col overflow-y-auto overscroll-contain pb-[var(--tab-bar-space)]"
          >
            <Outlet />
          </main>
        </ScrollRootProvider>
        <BottomNav />
        <LookupLayer />
        <ShadowSheetHost />
      </div>
    </ShadowSheetProvider>
  );
}
