// library 的公共接口(spec 2026-10-13-video-import §11.1、E9):其他目录只能从这里引入 library(src/architecture.test.ts 约束)。
// 页面按路由懒加载(lazy-pages.tsx);`useLibraryEnabled` 给底部标签用(layout/bottom-nav.tsx,与 useRoomsEnabled 同一做法)。
// 不要在这里静态导出页面模块、library-api、视觉层或动效。
export { LibraryListPage, LibraryPlayerPage } from "./lazy-pages";
export { useLibraryEnabled } from "./use-library-enabled";
