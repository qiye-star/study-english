import { useTranslation } from "react-i18next";
import { PageHeader } from "~/layout/page-header";

/** 占位:Task 4.2 替换为对话页。 */
export function ConversationPage() {
  const { t } = useTranslation();
  return <PageHeader title={t("web.nav.chat")} />;
}
