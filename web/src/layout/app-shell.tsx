import { Outlet } from "react-router-dom";
import { LookupLayer } from "~/features/lookup/lookup-layer";
import { BottomNav } from "./bottom-nav";
import { useAppHeight } from "./use-app-height";

export function AppShell() {
  useAppHeight();
  return (
    <div className="relative flex flex-col bg-background" style={{ height: "var(--app-height, 100dvh)" }}>
      <main className="flex min-h-0 flex-1 flex-col overflow-y-auto overscroll-contain">
        <Outlet />
      </main>
      <BottomNav />
      <LookupLayer />
    </div>
  );
}
