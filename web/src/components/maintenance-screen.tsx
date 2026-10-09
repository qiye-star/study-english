import { Wrench } from "lucide-react";
import { useTranslation } from "react-i18next";

/** 全站维护(MAINTENANCE_MODE=full)时代替整个应用显示的维护页;不渲染导航。 */
export function MaintenanceScreen({ message, onRetry }: { message?: string; onRetry?: () => void }) {
  const { t } = useTranslation();
  return (
    <main
      className="flex min-h-[100dvh] flex-col items-center justify-center gap-4 bg-background px-8 pb-[env(safe-area-inset-bottom)] pt-[env(safe-area-inset-top)] text-center"
    >
      <span className="flex h-14 w-14 items-center justify-center rounded-full bg-amber-tint text-amber">
        <Wrench className="h-7 w-7" aria-hidden="true" />
      </span>
      <h1 className="text-[22px] font-semibold text-ink">{t("web.announcements.maintenanceTitle")}</h1>
      <p className="max-w-[320px] whitespace-pre-wrap text-[15px] leading-[22px] text-ink-2">{message || t("web.announcements.maintenanceBody")}</p>
      {onRetry && (
        <button type="button" onClick={onRetry} className="min-h-[44px] rounded-full bg-surface-2 px-6 text-[15px] font-medium text-ink">
          {t("web.announcements.checkAgain")}
        </button>
      )}
    </main>
  );
}
