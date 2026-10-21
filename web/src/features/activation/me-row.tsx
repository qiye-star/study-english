import { MoonIcon } from "lucide-react";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { useAuth } from "~/auth/auth-context";
import { IconChip } from "~/components/icon-chip";
import { ListRow } from "~/components/section-group";
import { fetchWords } from "./activation-api";
import { useActivationEnabled } from "./use-activation-config";

/** meRows 贡献(我的 → 学习):「沉睡词 n」一行。只在配置开启时显示;数字取不到就不显示数字。 */
export function ActivationMeRow() {
  const { t } = useTranslation();
  const { api } = useAuth();
  const enabled = useActivationEnabled();
  const [dormant, setDormant] = useState<number | null>(null);
  useEffect(() => {
    if (!enabled) return;
    const ctl = new AbortController();
    fetchWords(api, "dormant", 0, ctl.signal).then(
      (page) => setDormant(page.counts.dormant),
      () => setDormant(null),
    );
    return () => ctl.abort();
  }, [api, enabled]);
  if (!enabled) return null;
  return (
    <ListRow icon={<IconChip tone="blue" icon={MoonIcon} />} title={t("web.activation.meRow")}
      subtitle={dormant === null ? undefined : t("web.activation.meRowCount", { count: dormant })}
      to="/me/activation" testId="activation-me-row" />
  );
}
