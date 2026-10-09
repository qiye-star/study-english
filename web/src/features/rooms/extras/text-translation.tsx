import { LoaderIcon } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { TranslationState } from "~/features/chat";

/**
 * 文本消息「译」的结果,显示在气泡下方(视觉稿 V12 .trans:13px 次要色、行高 1.5),观感与对话页的 MessageTranslation 一致
 * (加载中转圈 + 「翻译中…」、失败红字 + 「重试」)。译文按收听者各自请求、IndexedDB 缓存(R2-14)。
 */
export function TextTranslation({ state, onRetry }: { state?: TranslationState; onRetry(): void }) {
  const { t } = useTranslation();
  const box = "mt-1 max-w-full pl-0.5 text-sub leading-dialogue";
  if (!state || state.status === "loading") {
    return (
      <p data-testid="room-translation" data-status="loading" className={`${box} flex items-center gap-1.5 text-ink-2`}>
        <LoaderIcon aria-hidden className="size-3.5 animate-spin" />{t("web.chat.translating")}
      </p>
    );
  }
  if (state.status === "error") {
    return (
      <div data-testid="room-translation" data-status="error" className={`${box} flex flex-wrap items-center gap-x-2 text-red`}>
        <span>{state.error}</span>
        <button type="button" onClick={onRetry}
          className="-my-2 inline-flex min-h-tap items-center rounded-button px-2 font-medium text-blue focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
          {t("web.common.retry")}
        </button>
      </div>
    );
  }
  return <p data-testid="room-translation" data-status="done" className={`${box} select-text whitespace-pre-wrap text-ink-2`}>{state.text}</p>;
}
