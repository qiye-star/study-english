import { useTranslation } from "react-i18next";
import { PageHeader } from "~/layout/page-header";

/** 占位:Task 3.4 替换为评测详情页。 */
export function AssessmentPage() {
  const { t } = useTranslation();
  return <PageHeader title={t("web.nav.practice")} />;
}
