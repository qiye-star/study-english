import "./locales";
import { lazy, Suspense, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useParams } from "react-router-dom";
import { useAuth } from "~/auth/auth-context";
import { ConversationPage } from "../conversation-page";
import { refreshOnEnter } from "./chat-home-open";
import { requestToday, useChatHomeState } from "./chat-home-store";
import { homeChrome } from "./home-chrome";
import { playGreetingFlyIn } from "./greeting-fly";
import { useGreetingPopup } from "./greeting-popup";
import { HistoryDrawer } from "./history-drawer";
import { NewChat } from "./new-chat";

// 问候弹窗是懒块(计划 K5);它的样式、动画、分词都随它走
const GreetingModal = lazy(() => import("./greeting-modal").then((m) => ({ default: m.GreetingModal })));

export type HomeKind = "today" | "new" | "conversation";

/** 今天的对话加载中 / 失败(FR11):抽屉仍可打开,所以失败态也带历史按钮。 */
function TodayPlaceholder({ error, onRetry, onOpenHistory, historyOpen, historyButtonRef }: {
  error: boolean; onRetry(): void; onOpenHistory(): void; historyOpen: boolean; historyButtonRef: React.RefObject<HTMLButtonElement | null>;
}) {
  const { t } = useTranslation();
  if (!error) return <div aria-busy="true" data-testid="chat-home-loading" className="flex-1" aria-label={t("web.chat.home.route.loading")} />;
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-2 px-gutter text-center" data-testid="chat-home-error">
      <button ref={historyButtonRef} type="button" data-testid="chat-history-open" aria-haspopup="dialog" aria-expanded={historyOpen}
        onClick={onOpenHistory} className="sr-only focus:not-sr-only">
        {t("web.chat.home.bar.historyOpen")}
      </button>
      <p role="alert" className="text-sub text-red">{t("web.chat.home.route.loadFailed")}</p>
      <button type="button" data-testid="chat-home-retry" onClick={onRetry}
        className="inline-flex min-h-tap items-center rounded-button px-4 font-semibold text-blue focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
        {t("web.chat.home.route.retry")}
      </button>
    </div>
  );
}

/**
 * 对话主页的新外框(懒加载块,FR1):今天的对话 / 新对话草稿 / 指定对话,共用同一个历史抽屉与设置面板。
 * 同一个 ConversationPage,换的只是外框插槽(顶栏、设置面板、空状态)。问候弹窗只属于 `kind="today"`(只在 /chat 出现,FR10)。
 */
export default function ChatHomeShell({ kind }: { kind: HomeKind }) {
  const { t, i18n } = useTranslation();
  const { api } = useAuth();
  const params = useParams();
  const home = useChatHomeState();
  const [historyOpen, setHistoryOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const historyButtonRef = useRef<HTMLButtonElement | null>(null);

  // 进入 /chat:还没有结果(打开检测没跑起来)按一次「打开」取;跨午夜 / 仍 pending 时 refreshOnEnter 重取
  useEffect(() => {
    if (kind !== "today") return;
    const s = home.phase;
    if (s === "idle") void requestToday(api, { open: true });
    else refreshOnEnter(api);
    // 只在进入时判断一次
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [kind, api]);

  const popup = useGreetingPopup(api, kind === "today");
  const todayId = home.today?.conversation.id ?? null;
  const greeting = home.today?.greeting ?? null;
  const chrome = homeChrome({
    t, lang: i18n.language, todayId,
    historyOpen, onOpenHistory: () => setHistoryOpen(true), historyButtonRef,
    settingsOpen, onSettingsOpenChange: setSettingsOpen,
    greeting,
    onReplay: kind === "today" && home.today?.status === "ready" && greeting ? popup.replay : undefined,
  });
  const openHistory = () => setHistoryOpen(true);

  let body;
  let currentId: string | null = null;
  if (kind === "new") {
    body = <NewChat historyOpen={historyOpen} onOpenHistory={openHistory} historyButtonRef={historyButtonRef} />;
  } else if (kind === "conversation") {
    currentId = params.id ?? null;
    body = <ConversationPage key={currentId ?? ""} chrome={chrome} />;
  } else if (home.phase === "ready" && home.today) {
    currentId = home.today.conversation.id;
    body = <ConversationPage key={currentId} conversationId={currentId} chrome={chrome} />;
  } else {
    body = <TodayPlaceholder error={home.phase === "error"} onRetry={() => void requestToday(api, { open: true })}
      onOpenHistory={openHistory} historyOpen={historyOpen} historyButtonRef={historyButtonRef} />;
  }

  return (
    <>
      {body}
      {kind === "today" && popup.mode && home.today && greeting ? (
        <Suspense fallback={null}>
          <GreetingModal lines={greeting.lines} language={greeting.language} localDate={home.today.localDate} facts={greeting.facts}
            mode={popup.mode} onShown={popup.onShown} onClose={popup.close} playExit={(targets) => playGreetingFlyIn(targets)} />
        </Suspense>
      ) : null}
      <HistoryDrawer open={historyOpen} onOpenChange={setHistoryOpen} currentId={currentId}
        onCloseAutoFocus={(e) => { e.preventDefault(); historyButtonRef.current?.focus({ preventScroll: true }); }} />
    </>
  );
}
