import { useTranslation } from "react-i18next";
import { PageHeader } from "~/layout/page-header";

/** 占位:Task 4.1 替换为对话列表页。 */
export function ConversationsPage() {
  const { t } = useTranslation();
  return <PageHeader title={t("web.nav.chat")} />;
}
