// wordbook 的公共接口:其他目录只能从这里引入 wordbook(由 src/architecture.test.ts 约束)。
export { useWordbookConfig, useWordbookEnabled } from "./use-wordbook-config";
export { WordbookCard } from "./wordbook-card";
export { WordbookMiniCard } from "./wordbook-mini-card";
export { WordbookMeRow } from "./me-row";
// 页面按路由懒加载(lazy-pages.tsx,集成裁定 Z-h);不要在这里静态导出页面模块
export { WordbookBooksPage, WordbookHomePage, WordbookLearnPage, WordbookLearnedPage, WordbookReviewPage, WordbookSpellPage } from "./lazy-pages";
