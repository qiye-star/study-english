import { useTranslation } from "react-i18next";
import { PageHeader } from "~/layout/page-header";

/** 占位:Task 3.3 替换为跟读评测页。 */
export function PracticePage() {
  const { t } = useTranslation();
  return <PageHeader title={t("web.nav.practice")} />;
}
