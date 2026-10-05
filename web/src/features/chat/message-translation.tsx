import { LoaderIcon } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "@renderer/components/ui/button";
import type { TranslationState } from "./use-message-translations";

export function MessageTranslation({ state, onRetry }: { state?: TranslationState; onRetry(): void }) {
  const { t } = useTranslation();
  if (!state || state.status === "loading") {
    return (
      <p data-testid="message-translation" data-status="loading" className="mt-2 flex items-center gap-2 border-t pt-2 text-sm text-muted-foreground">
        <LoaderIcon className="h-4 w-4 animate-spin" />{t("web.chat.translating")}
      </p>
    );
  }
  if (state.status === "error") {
    return (
      <div data-testid="message-translation" data-status="error" className="mt-2 border-t pt-2 text-sm text-destructive">
        <span>{state.error}</span>
        <Button variant="link" className="h-11 px-2" onClick={onRetry}>{t("web.common.retry")}</Button>
      </div>
    );
  }
  return (
    <p data-testid="message-translation" data-status="done" data-lookup-context className="mt-2 select-text whitespace-pre-wrap border-t pt-2 text-sm">
      {state.text}
    </p>
  );
}
