import { type ComponentType, lazy, Suspense } from "react";
import { PageLoading } from "./page-status";

/**
 * 背单词各页按路由懒加载(集成裁定 Z-h):练习页大卡与「我的」一行仍随主包,页面本身各自成块,
 * 主包不因背单词变大。每个页面自带 Suspense,app.tsx 的路由写法不变。
 */
function lazyPage<K extends string>(load: () => Promise<Record<K, ComponentType>>, name: K): ComponentType {
  const Page = lazy(async (): Promise<{ default: ComponentType }> => ({ default: (await load())[name] }));
  function LazyPage() {
    return (
      <Suspense fallback={<PageLoading />}>
        <Page />
      </Suspense>
    );
  }
  LazyPage.displayName = name;
  return LazyPage;
}

export const WordbookHomePage = lazyPage(() => import("./home-page"), "WordbookHomePage");
export const WordbookBooksPage = lazyPage(() => import("./books-page"), "WordbookBooksPage");
export const WordbookLearnPage = lazyPage(() => import("./learn-page"), "WordbookLearnPage");
export const WordbookReviewPage = lazyPage(() => import("./review-page"), "WordbookReviewPage");
export const WordbookSpellPage = lazyPage(() => import("./spell/spell-page"), "WordbookSpellPage");
export const WordbookLearnedPage = lazyPage(() => import("./learned-page"), "WordbookLearnedPage");
