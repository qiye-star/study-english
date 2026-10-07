import { LoaderIcon } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { TranslationState } from "./use-message-translations";

/** 气泡里的译文:0.5px 分隔线下 13px 次要色(设计稿 .tr)。 */
const box = "mt-1.5 border-t-[0.5px] border-hair-2 pt-1.5 text-sub leading-dialogue";

export function MessageTranslation({ state, onRetry }: { state?: TranslationState; onRetry(): void }) {
  const { t } = useTranslation();
  if (!state || state.status === "loading") {
    return (
      <p data-testid="message-translation" data-status="loading" className={`${box} flex items-center gap-2 text-ink-2`}>
        <LoaderIcon aria-hidden className="h-4 w-4 animate-spin" />{t("web.chat.translating")}
      </p>
    );
  }
  if (state.status === "error") {
    return (
      <div data-testid="message-translation" data-status="error" className={`${box} flex flex-wrap items-center gap-x-2 text-red`}>
        <span>{state.error}</span>
        <button type="button" className="-my-2 inline-flex min-h-tap items-center rounded-button px-2 font-medium text-blue focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          onClick={onRetry}>{t("web.common.retry")}</button>
      </div>
    );
  }
  return (
    <p data-testid="message-translation" data-status="done" className={`${box} select-text whitespace-pre-wrap text-ink-2`}>
      {state.text}
    </p>
  );
}
