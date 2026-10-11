import { AlertTriangleIcon } from "lucide-react";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { useAuth } from "~/auth/auth-context";
import { IconChip } from "~/components/icon-chip";
import { LIST_CARD } from "~/components/list-card";
import { ListRow } from "~/components/section-group";
import { fetchMistakes } from "./mistakes-api";

/** notebookViews 贡献:生词本页「全部」上方的「易错词 · n」(琥珀 = 弱项);失败或 0 时显示「暂无」。 */
export function MistakesRow() {
  const { api } = useAuth();
  const { t } = useTranslation();
  const [total, setTotal] = useState<number | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    fetchMistakes(api, 1, controller.signal).then(
      (data) => { if (!controller.signal.aborted) setTotal(data.total); },
      () => { if (!controller.signal.aborted) setTotal(0); },
    );
    return () => controller.abort();
  }, [api]);

  return (
    <div className={LIST_CARD}>
      <ListRow icon={<IconChip tone="amber" icon={AlertTriangleIcon} />} title={t("web.links.mistakes.title")}
        value={total === null ? undefined : <span className="tabular-nums">{total > 0 ? total : t("web.links.mistakes.none")}</span>}
        to="/links/mistakes" testId="notebook-mistakes" />
    </div>
  );
}
