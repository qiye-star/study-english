import { lazy, Suspense } from "react";

const Page = lazy(() => import("./conversation-page").then((m) => ({ default: m.ConversationPage })));

/**
 * 对话详情页按路由懒加载(agents-web R-W2,与 wordbook/lazy-pages.tsx 的 Z-h 同法):会话列表仍随主包;
 * 详情页(录音、通话、复盘、智能体集成)各自成块,抵消智能体集成在主包里的字节。测试直接导入 ./conversation-page。
 */
export function ConversationPage() {
  return (
    <Suspense fallback={<div aria-busy="true" className="flex-1" />}>
      <Page />
    </Suspense>
  );
}
