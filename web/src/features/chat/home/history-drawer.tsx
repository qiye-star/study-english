import "./locales";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { PlusIcon, Trash2Icon, XIcon } from "lucide-react";
import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { useTranslation } from "react-i18next";
import { useLocation, useNavigate } from "react-router-dom";
import { useAuth } from "~/auth/auth-context";
import { IconButton } from "~/components/icon-button";
import { LQ_DANGER_TEXT, LQ_SECONDARY } from "~/components/liquid";
import { cn } from "~/lib/cn";
import { localDateString } from "~/lib/tz-offset";
import { deleteConversation, type Conversation } from "../chat-api";
import { displayName } from "../chat-request";
import { type TodayGreeting } from "./chat-home-api";
import { rebuildToday, useChatHomeState } from "./chat-home-store";
import { dailyDateText, dateLabel, groupByActivityDay } from "./date-label";
import { stripEmphasis } from "./emphasis";
import { swipeEnd, swipeMove, swipeStart, type SwipeState } from "./swipe-close";
import { useHistory } from "./use-history";

/** 历史按钮的 `aria-controls` 指向它。 */
export const HISTORY_DRAWER_ID = "chat-history-drawer";

const ROW_CLASS = "flex min-h-row min-w-0 flex-1 items-center gap-3 rounded-[10px] py-2.5 pl-3 text-left transition-colors duration-fast hover:bg-surface-2 active:bg-surface-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring liquid:rounded-tile";

function greetingPreview(greeting: TodayGreeting | null): string | null {
  const first = greeting?.lines[0];
  const text = greeting?.language === "zh" ? first?.zh : first?.en ?? first?.zh;
  return text ? stripEmphasis(text) : null;
}

interface PendingDelete { conversation: Conversation; today: boolean }

/**
 * 左侧浮动历史抽屉(FR7):Radix Dialog 做模态外壳(焦点圈定、Esc、关闭后焦点回到打开前的元素),
 * 内容 = 新建 + 今天置顶卡 + 按最近活动日分组的历史 + 加载更多。选中一行 = 关闭抽屉并导航。
 * 抽屉与遮罩都是 fixed 视口级,遮罩不模糊(玻璃预算);左滑关闭的判定在 swipe-close.ts。
 */
export function HistoryDrawer({ open, onOpenChange, currentId }: {
  open: boolean;
  onOpenChange(open: boolean): void;
  /** 当前显示的对话 id(aria-current) */
  currentId?: string | null;
}) {
  const { t, i18n } = useTranslation();
  const { api } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const { today } = useChatHomeState();
  const history = useHistory(api, open);
  const [pendingDelete, setPendingDelete] = useState<PendingDelete | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);
  // 确认条出现时把焦点放到「取消」(不弹第二层模态:嵌套的上游 AlertDialog 会与抽屉的焦点圈互相抢焦点)
  useEffect(() => { if (pendingDelete) cancelRef.current?.focus(); }, [pendingDelete]);

  // 左滑关闭
  const swipe = useRef<SwipeState | null>(null);
  const swallowClick = useRef(false);
  const [dragX, setDragX] = useState(0);
  const onPointerDown = (e: ReactPointerEvent<HTMLElement>) => {
    if (e.pointerType === "mouse" && e.button !== 0) return;
    swipe.current = swipeStart(e.clientX, e.clientY, e.currentTarget.offsetWidth);
  };
  const onPointerMove = (e: ReactPointerEvent<HTMLElement>) => {
    if (!swipe.current) return;
    swipe.current = swipeMove(swipe.current, e.clientX, e.clientY);
    if (swipe.current.taking) setDragX(swipe.current.offset);
  };
  const onPointerEnd = () => {
    const s = swipe.current;
    swipe.current = null;
    if (!s) return;
    const end = swipeEnd(s);
    setDragX(0);
    if (end.swallowClick) {
      swallowClick.current = true;
      window.setTimeout(() => { swallowClick.current = false; }, 0);
    }
    if (end.close) onOpenChange(false);
  };

  const nowDay = today?.localDate ?? localDateString();
  const todayId = today?.conversation.id ?? null;
  const rows = history.items.filter((c) => c.id !== todayId); // 今天置顶卡来自 store;列表里不出现两次
  const groups = groupByActivityDay(rows, nowDay);
  const lang = i18n.language;

  const go = (path: string) => {
    onOpenChange(false);
    navigate(path);
  };

  const confirmDelete = async () => {
    const target = pendingDelete;
    if (!target) return;
    setDeleteError(null);
    try {
      await deleteConversation(api, target.conversation.id);
    } catch {
      setDeleteError(t("web.chat.home.drawer.deleteFailed"));
      return; // store 不动
    } finally {
      setPendingDelete(null);
    }
    if (target.today) {
      // 立即重建(不是一次「打开」:不弹窗);在 /chat/:旧id 上先回到 /chat
      if (location.pathname !== "/chat") navigate("/chat", { replace: true });
      void rebuildToday(api);
    } else {
      history.remove(target.conversation.id);
      if (currentId === target.conversation.id) navigate("/chat", { replace: true });
    }
  };

  const errorText = deleteError ?? history.error;
  const preview = greetingPreview(today?.greeting ?? null);
  const facts = today?.greeting?.facts;

  return (
    <DialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay data-testid="chat-history-overlay"
          className="fixed inset-0 z-50 bg-scrim data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 motion-reduce:animate-none" />
        <DialogPrimitive.Content id={HISTORY_DRAWER_ID} data-testid="chat-history-drawer" aria-describedby={undefined}
          onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerEnd} onPointerCancel={onPointerEnd}
          onClickCapture={(e) => { if (swallowClick.current) { swallowClick.current = false; e.preventDefault(); e.stopPropagation(); } }}
          style={dragX ? { transform: `translateX(${dragX}px)`, transition: "none" } : undefined}
          className={cn(
            "fixed inset-y-0 left-0 z-50 flex h-[100dvh] w-[min(82vw,340px)] flex-col bg-surface text-ink shadow-[12px_0_32px_-16px_rgba(17,19,24,0.35)] focus:outline-none [touch-action:pan-y]",
            "data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:slide-out-to-left data-[state=open]:slide-in-from-left data-[state=closed]:duration-200 data-[state=open]:duration-300 motion-reduce:animate-none",
          )}>
          <div className="flex items-center justify-between gap-2 pl-4 pr-1 pt-[max(12px,calc(env(safe-area-inset-top)+8px))]">
            <DialogPrimitive.Title className="text-title font-semibold">{t("web.chat.home.drawer.title")}</DialogPrimitive.Title>
            <DialogPrimitive.Close asChild>
              <IconButton label={t("web.chat.home.drawer.close")} className="text-ink-2"><XIcon /></IconButton>
            </DialogPrimitive.Close>
          </div>
          <div className="px-3 pb-2 pt-1">
            <button type="button" data-testid="chat-history-new" onClick={() => go("/chat/new")}
              className="flex min-h-tap w-full items-center justify-center gap-1.5 rounded-button bg-blue px-3 text-sub font-semibold text-on-blue transition-opacity duration-fast hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 liquid:rounded-full">
              <PlusIcon aria-hidden className="h-4 w-4" />{t("web.chat.home.drawer.new")}
            </button>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-3 pb-[calc(1rem+env(safe-area-inset-bottom))]">
            {today && (
              <div className="mb-2 flex items-center rounded-card bg-surface-2 pr-1 liquid:rounded-tile">
                <button type="button" data-testid="chat-history-today" aria-current={currentId === todayId ? "page" : undefined}
                  onClick={() => go("/chat")} className={ROW_CLASS}>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-body font-semibold">{t("web.chat.home.drawer.today")}</span>
                    <span className="mt-0.5 block text-meta text-ink-2">{dailyDateText(today.conversation.dailyDate, lang)}</span>
                    <span className="mt-1 block truncate text-sub text-ink-2">{preview ?? t("web.chat.home.drawer.noPreview")}</span>
                    {facts && (facts.streak !== undefined || facts.due !== undefined) && (
                      <span className="num mt-0.5 block text-meta text-ink-2">
                        {[facts.streak !== undefined ? t("web.chat.home.drawer.streak", { count: facts.streak }) : null,
                          facts.due !== undefined ? t("web.chat.home.drawer.due", { count: facts.due }) : null].filter(Boolean).join(" · ")}
                      </span>
                    )}
                  </span>
                </button>
                <IconButton data-testid="chat-history-today-delete" className="text-ink-2" label={t("web.chat.home.drawer.more")}
                  onClick={() => setPendingDelete({ conversation: today.conversation, today: true })}>
                  <Trash2Icon />
                </IconButton>
              </div>
            )}
            {!history.loaded && <p className="py-6 text-center text-sub text-ink-2">{t("web.common.loading")}</p>}
            {errorText && (
              <div role="alert" className="mb-2 flex items-center gap-2 rounded-card bg-surface-2 py-1 pl-3 pr-1 text-sub text-red">
                <span className="flex-1">{errorText}</span>
                {history.error && !history.items.length && (
                  <button type="button" onClick={() => void history.reload()}
                    className="inline-flex min-h-tap items-center rounded-button px-3 font-semibold text-blue focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                    {t("web.common.retry")}
                  </button>
                )}
              </div>
            )}
            {history.loaded && !rows.length && !history.error && (
              <p data-testid="chat-history-empty" className="py-6 text-center text-sub text-ink-2">{t("web.chat.home.drawer.empty")}</p>
            )}
            {groups.map((group) => (
              <section key={group.day} aria-label={dateLabel(group.day, nowDay, lang)} className="mt-2">
                <h3 className="px-3 pb-1 text-meta font-medium text-ink-2">{dateLabel(group.day, nowDay, lang)}</h3>
                <ul>
                  {group.items.map((c) => {
                    const name = c.dailyDate
                      ? `${t("web.chat.home.drawer.dailyChat")} · ${dailyDateText(c.dailyDate, lang)}`
                      : displayName(c, t("web.chat.untitled"));
                    return (
                      <li key={c.id} className="flex items-center pr-1">
                        <button type="button" data-testid="conversation-item" aria-current={currentId === c.id ? "page" : undefined}
                          onClick={() => go(`/chat/${encodeURIComponent(c.id)}`)} className={ROW_CLASS}>
                          <span className="block min-w-0 flex-1 truncate text-body font-medium">{name}</span>
                        </button>
                        <IconButton data-testid="conversation-delete" className="text-ink-2" label={t("web.common.delete")}
                          onClick={() => setPendingDelete({ conversation: c, today: false })}>
                          <Trash2Icon />
                        </IconButton>
                      </li>
                    );
                  })}
                </ul>
              </section>
            ))}
            {history.next && (
              <button type="button" disabled={history.loadingMore} onClick={history.loadMore}
                className="mx-auto mt-2 flex min-h-tap items-center rounded-button px-4 text-sub font-medium text-blue focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50">
                {t("web.common.loadMore")}
              </button>
            )}
          </div>
        {pendingDelete && (
          <div role="alertdialog" aria-labelledby="chat-history-confirm-text" data-testid="chat-history-confirm"
            className="border-t-[0.5px] border-hair bg-surface px-4 pb-[calc(1rem+env(safe-area-inset-bottom))] pt-3">
            <p id="chat-history-confirm-text" className="text-sub font-medium text-ink">
              {pendingDelete.today ? t("web.chat.home.drawer.deleteTodayConfirm") : t("web.chat.deleteConfirm")}
            </p>
            <div className="mt-3 flex gap-2">
              <button type="button" ref={cancelRef} onClick={() => setPendingDelete(null)}
                className={`inline-flex h-11 flex-1 items-center justify-center rounded-button bg-surface-2 text-sub font-semibold text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${LQ_SECONDARY}`}>
                {t("web.common.cancel")}
              </button>
              <button type="button" data-testid="conversation-delete-confirm" onClick={() => void confirmDelete()}
                className={`inline-flex h-11 flex-1 items-center justify-center rounded-button bg-red-solid text-sub font-semibold text-white hover:bg-red-solid/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${LQ_DANGER_TEXT} liquid:hover:bg-wash-2`}>
                {t("web.common.delete")}
              </button>
            </div>
          </div>
        )}
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}
