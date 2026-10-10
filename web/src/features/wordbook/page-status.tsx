import { LoaderIcon } from "lucide-react";
import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { PAGE_NOTE } from "~/components/list-card";

/** 页面加载中(居中转圈)。 */
export function PageLoading() {
  const { t } = useTranslation();
  return (
    <div data-testid="wordbook-loading" className="flex justify-center py-16 text-ink-2">
      <LoaderIcon className="size-5 animate-spin" aria-label={t("web.common.loading")} />
    </div>
  );
}

/** 页面内的错误说明(已翻译)+ 可选重试。 */
export function PageError({ message, onRetry }: { message: string; onRetry?: () => void }) {
  const { t } = useTranslation();
  return (
    <div role="alert" data-testid="wordbook-error" className="flex flex-col items-center gap-2 px-6 py-12 text-center text-sub text-ink-2">
      <p>{message}</p>
      {onRetry ? (
        <button type="button" onClick={onRetry}
          className="min-h-tap rounded-button px-4 font-semibold text-blue focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
          {t("web.common.retry")}
        </button>
      ) : null}
    </div>
  );
}

/** 页面内的提示 / 空状态文字。 */
export function PageNote({ children }: { children: ReactNode }) {
  return <p className={PAGE_NOTE}>{children}</p>;
}
