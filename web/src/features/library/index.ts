// library 的公共接口(spec 2026-10-13-video-import §11.1、E9):其他目录只能从这里引入 library(src/architecture.test.ts 约束)。
// 页面按路由懒加载(lazy-pages.tsx);`useLibraryEnabled` 给底部标签用(layout/bottom-nav.tsx,与 useRoomsEnabled 同一做法)。
// 不要在这里静态导出页面模块、library-api、视觉层或动效。
export { LibraryListPage, LibraryPlayerPage } from "./lazy-pages";
export { useLibraryEnabled } from "./use-library-enabled";
// 配音的懒加载工具包(计划 L5 R17):两行都不是 `export … from`,主包守卫不把它们当静态导出。
export const loadDubbingKit = () => import("./dubbing-kit");
export type DubbingKit = Awaited<ReturnType<typeof loadDubbingKit>>;
