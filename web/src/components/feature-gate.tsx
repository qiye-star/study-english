import { LoaderIcon } from "lucide-react";
import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";

export type GateState = "loading" | "disabled" | "error" | "ready";

/** 功能开关与加载态的统一外壳:加载(转圈)/ 功能关闭(说明)/ 出错(重试)/ 就绪(children)。 */
export function FeatureGate({ state, disabledText, onRetry, children }: {
  state: GateState; disabledText: string; onRetry?: () => void; children: ReactNode;
}) {
  const { t } = useTranslation();
  if (state === "ready") return <>{children}</>;
  if (state === "loading") {
    return <div data-testid="feature-gate-loading" className="flex justify-center py-16 text-ink-2"><LoaderIcon className="size-5 animate-spin" aria-label={t("web.common.loading")} /></div>;
  }
  if (state === "disabled") return <p className="px-4 py-16 text-center text-[13px] text-ink-2">{disabledText}</p>;
  return (
    <div className="flex flex-col items-center gap-3 px-4 py-16 text-center text-[13px] text-ink-2">
      <p>{t("web.common.loadFailed")}</p>
      <button type="button" data-testid="feature-gate-retry" onClick={onRetry} className="min-h-11 px-4 font-semibold text-blue">{t("web.common.retry")}</button>
    </div>
  );
}
