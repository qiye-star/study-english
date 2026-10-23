import { lazy, Suspense, type ComponentProps } from "react";
import { useTranslation } from "react-i18next";

/** 已结束页按路由懒加载(主包不增长:计划 2026-10-12-rooms-reopen,全局约束)。 */
const Page = lazy(async () => ({ default: (await import("./ended/ended-rooms-page")).RoomsEndedPage }));

function Loading() {
  const { t } = useTranslation();
  return <p role="status" className="px-gutter py-16 text-center text-sub text-ink-2">{t("web.common.loading")}</p>;
}

export function RoomsEndedPage(props: ComponentProps<typeof Page>) {
  return (
    <Suspense fallback={<Loading />}>
      <Page {...props} />
    </Suspense>
  );
}
