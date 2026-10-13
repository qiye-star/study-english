import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { readDoubleTapHintSeen, writeDoubleTapHintSeen } from "./double-tap-pref";
import "./locales";

/**
 * 一次性提示「双击选项可查词」(spec 2026-10-13-review-after-answer §2.3):挂载时读本机记忆,没看过就显示,并马上记下来;
 * 这一道题内一直显示(状态在组件里),之后每个新实例读到「看过」就不显示。没有 role=status(复习页的结果行是唯一的 status)。
 */
export function DoubleTapHint() {
  const { t } = useTranslation();
  const [show] = useState(() => !readDoubleTapHintSeen());
  useEffect(() => {
    if (show) writeDoubleTapHintSeen();
  }, [show]);
  return show ? <p data-testid="double-tap-hint" className="mt-3 text-sub text-ink-2">{t("web.wordbookDefs.after.hint")}</p> : null;
}
