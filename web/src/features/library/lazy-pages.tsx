import { type ComponentType, lazy, Suspense } from "react";
import { PageLoading } from "./page-status";

/** 跟读库两页按路由懒加载(R-L23,同 wordbook/lazy-pages.tsx):每页自带 Suspense,app.tsx 的路由写法不变。 */
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

export const LibraryListPage = lazyPage(() => import("./library-list-page"), "LibraryListPage");
export const LibraryPlayerPage = lazyPage(() => import("./player-page"), "LibraryPlayerPage");
