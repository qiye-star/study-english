import { ShareIcon } from "lucide-react";
import { useTranslation } from "react-i18next";
import { PageHeader } from "~/layout/page-header";

export function InstallPage() {
  const { t } = useTranslation();
  return (
    <div className="min-h-[100dvh] pt-[env(safe-area-inset-top)]">
      <PageHeader title={t("web.install.title")} back="/me" />
      <ol className="list-decimal space-y-4 p-6 pl-10 text-base">
        <li>{t("web.install.step1")} <ShareIcon className="inline h-4 w-4" aria-hidden /></li>
        <li>{t("web.install.step2")}</li>
        <li>{t("web.install.step3")}</li>
      </ol>
      <p className="px-6 text-sm text-muted-foreground">{t("web.install.httpsNote")}</p>
    </div>
  );
}
