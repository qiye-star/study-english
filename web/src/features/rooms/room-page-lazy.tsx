import { lazy, Suspense } from "react";

/**
 * 房间页懒加载(plan 2026-10-12-agents-rooms R-RA11):房间页、助手、语音与智能体界面都不进主包(spec R-A2 的体积预算)。
 * 自带 Suspense,app.tsx 的路由不用改;占位与房间页同为可伸展的 flex 列,切换时不跳动。
 */
const Inner = lazy(() => import("./room-page").then((m) => ({ default: m.RoomPage })));

export function RoomPage() {
  return (
    <Suspense fallback={<div data-testid="room-page-loading" aria-busy="true" className="flex min-h-0 flex-1 flex-col" />}>
      <Inner />
    </Suspense>
  );
}
