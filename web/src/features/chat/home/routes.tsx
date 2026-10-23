import { lazy, Suspense, type ReactNode } from "react";
import { Navigate } from "react-router-dom";
import { ConversationPage, ConversationsPage } from "../lazy-pages";
import { useChatHomeConfig } from "./use-chat-home-config";

// 路由分发(主包,刻意很小):按 `CHAT_HOME_ENABLED` 在新对话主页与旧页面之间选一个。新主页本体是懒加载块(FR1、FR2)。
const Shell = lazy(() => import("./chat-home-shell"));
const skeleton = <div aria-busy="true" data-testid="chat-home-loading" className="flex-1" />;

function Gate({ kind, off }: { kind: "today" | "new" | "conversation"; off: ReactNode }) {
  const { status } = useChatHomeConfig();
  if (status === "off") return off;
  return <Suspense fallback={skeleton}>{status === "on" ? <Shell kind={kind} /> : skeleton}</Suspense>;
}

/**
 * `/chat`:开 = 今天的对话;关(或配置失败 / 超时)= 旧会话列表。
 * `renderOff` 让 app.tsx 把旧列表包进「对话 / 联机」分区外壳(plan L6,chat 不能引入 rooms);缺省 = 裸列表。
 */
export const ChatIndexRoute = ({ renderOff }: { renderOff?: () => ReactNode }) => (
  <Gate kind="today" off={renderOff ? renderOff() : <ConversationsPage />} />
);
/** `/chat/new`:开 = 新对话草稿;关 = 回列表。 */
export const ChatNewRoute = () => <Gate kind="new" off={<Navigate to="/chat" replace />} />;
/** `/chat/:id`:开 = 同一外框里的该对话(从不弹问候);关 = 旧对话页原样。 */
export const ChatConversationRoute = () => <Gate kind="conversation" off={<ConversationPage />} />;
