import "./locales";
import { BotIcon } from "lucide-react";
import { useTranslation } from "react-i18next";
import { IconChip } from "~/components/icon-chip";
import { ListRow } from "~/components/section-group";
import { useAgentsConfig } from "./use-agents-data";

/** 「我的 → 学习」里的一行;智能体关闭或旧服务端时不渲染。 */
export function AgentsMeRow() {
  const { t } = useTranslation();
  const { config } = useAgentsConfig();
  if (!config?.enabled) return null;
  return (
    <ListRow icon={<IconChip tone="gray" icon={BotIcon} />} title={t("web.agents.meRow.title")} subtitle={t("web.agents.meRow.hint")}
      to="/me/agents" testId="me-agents" />
  );
}
