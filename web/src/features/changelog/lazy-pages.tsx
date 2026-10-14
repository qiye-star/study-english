import { LoaderIcon } from "lucide-react";
import { lazy, Suspense } from "react";
import { useTranslation } from "react-i18next";

/** 日志页按路由懒加载(计划 R-3,同 library/lazy-pages.tsx):页面、文案、样式都在懒加载块里,主包只有这个包装。 */
function PageLoading() {
  const { t } = useTranslation();
  return (
    <div data-testid="changelog-page-loading" className="flex justify-center py-16 text-ink-2">
      <LoaderIcon className="size-5 animate-spin" aria-label={t("web.common.loading")} />
    </div>
  );
}

const Page = lazy(async () => ({ default: (await import("./changelog-page")).ChangelogPage }));

export function ChangelogPage() {
  return (
    <Suspense fallback={<PageLoading />}>
      <Page />
    </Suspense>
  );
}
