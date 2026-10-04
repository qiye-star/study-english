import { useTranslation } from "react-i18next";
import { PageHeader } from "~/layout/page-header";

/** 占位:Task 3.4 替换为历史记录页。 */
export function HistoryPage() {
  const { t } = useTranslation();
  return <PageHeader title={t("web.nav.practice")} />;
}
