import { ShareIcon, SmartphoneIcon } from "lucide-react";
import { useTranslation } from "react-i18next";
import { LIST_CARD } from "~/components/list-card";
import { PageHeader } from "~/layout/page-header";

export function InstallPage() {
  const { t } = useTranslation();
  const steps = [
    <>{t("web.install.step1")} <ShareIcon className="inline h-4 w-4 align-[-2px] text-blue" aria-hidden /></>,
    t("web.install.step2"),
    t("web.install.step3"),
  ];
  return (
    <div className="min-h-[100dvh]">
      <PageHeader title={t("web.install.title")} back="/me" />
      <div className="px-gutter pb-6 pt-1 liquid:px-frame">
        <div className="flex items-center gap-3.5 px-0.5 pb-1">
          <span aria-hidden className="flex h-[60px] w-[60px] flex-none items-center justify-center rounded-sheet bg-blue-tint text-blue well liquid:rounded-full liquid:text-ink">
            <SmartphoneIcon className="h-7 w-7" />
          </span>
          <p className="text-body text-ink-2">{t("web.install.lede")}</p>
        </div>
        <ol className={`${LIST_CARD} mt-section`}>
          {steps.map((step, i) => (
            <li key={i} className="flex min-h-row items-center gap-3 py-2.5 pl-3.5 pr-3 text-body text-ink">
              <span aria-hidden className="num flex h-[34px] w-[34px] flex-none items-center justify-center rounded-full bg-blue-tint text-sub font-semibold text-blue well liquid:text-ink">
                {i + 1}
              </span>
              <span className="min-w-0 flex-1">{step}</span>
            </li>
          ))}
        </ol>
        <p className="mx-0.5 mt-3 text-meta text-ink-2">{t("web.install.httpsNote")}</p>
      </div>
    </div>
  );
}
