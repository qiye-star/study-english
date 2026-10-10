import { Link2Icon } from "lucide-react";
import { useTranslation } from "react-i18next";
import { IconChip } from "~/components/icon-chip";
import { ListRow } from "~/components/section-group";
import { LINK_KEYS } from "~/lib/extension-points";
import { useLinkFlags } from "~/lib/extension-points-react";

/** meRows 贡献(requiresLinks):「我的 → 学习」里的「学习联动 已开启 n/6」。 */
export function LinksMeRow() {
  const { t } = useTranslation();
  const flags = useLinkFlags();
  const on = LINK_KEYS.filter((k) => flags.links[k]).length;
  return (
    <ListRow icon={<IconChip tone="blue" icon={Link2Icon} />} title={t("web.links.settings.title")}
      subtitle={t("web.links.settings.rowSubtitle", { on, total: LINK_KEYS.length })} to="/me/links" testId="me-links" />
  );
}
