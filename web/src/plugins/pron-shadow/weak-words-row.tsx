import { MicIcon } from "lucide-react";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { useAuth } from "~/auth/auth-context";
import { IconChip } from "~/components/icon-chip";
import { LIST_CARD } from "~/components/list-card";
import { ListRow } from "~/components/section-group";
import { fetchWeakWords } from "./pron-api";

/** notebookViews 贡献:生词本「发音弱词 · n」入口(琥珀话筒片);失败或 0 时值显示「暂无」。 */
export function WeakWordsRow() {
  const { api } = useAuth();
  const { t } = useTranslation();
  const [total, setTotal] = useState<number | null>(null);
  useEffect(() => {
    const controller = new AbortController();
    fetchWeakWords(api, controller.signal).then(
      (page) => { if (!controller.signal.aborted) setTotal(page.total); },
      () => { if (!controller.signal.aborted) setTotal(0); },
    );
    return () => controller.abort();
  }, [api]);
  return (
    <div className={LIST_CARD}>
      <ListRow icon={<IconChip tone="amber" icon={MicIcon} />} title={t("web.links.pron.row")} to="/links/weak-words"
        testId="notebook-weak-words"
        value={total === null ? undefined : <span className="num">{total > 0 ? total : t("web.links.pron.none")}</span>} />
    </div>
  );
}
