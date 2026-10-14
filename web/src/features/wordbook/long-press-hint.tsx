import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { readLongPressHintSeen, writeLongPressHintSeen } from "./long-press-pref";
import "./locales";

/**
 * 一次性提示「长按选项里的单词可查询」(计划 2026-10-14-review-bilingual-longpress R-L6):挂载时读本机记忆,没看过就显示并马上记下;
 * 这一道题内一直显示,之后每个新实例读到「看过」就不显示。没有 role=status(复习页的结果行是唯一的 status)。
 */
export function LongPressHint() {
  const { t } = useTranslation();
  const [show] = useState(() => !readLongPressHintSeen());
  useEffect(() => {
    if (show) writeLongPressHintSeen();
  }, [show]);
  return show ? <p data-testid="long-press-hint" className="mt-3 text-sub text-ink-2">{t("web.wordbookDefs.after.longPressHint")}</p> : null;
}
