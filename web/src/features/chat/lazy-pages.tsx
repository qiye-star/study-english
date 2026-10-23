import { lazy, Suspense, type ComponentProps } from "react";

const List = lazy(() => import("./conversations-page").then((m) => ({ default: m.ConversationsPage })));
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

/** 旧会话列表页(`CHAT_HOME_ENABLED` 关时的 /chat)同样按路由懒加载:主包只留路由分发,新旧页面都各自成块(chat home K5)。 */
export function ConversationsPage(props: ComponentProps<typeof List>) {
  return (
    <Suspense fallback={<div aria-busy="true" className="flex-1" />}>
      <List {...props} />
    </Suspense>
  );
}
