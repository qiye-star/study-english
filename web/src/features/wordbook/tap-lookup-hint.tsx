import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { readTapLookupHintSeen, writeTapLookupHintSeen } from "./tap-lookup-pref";
import "./locales";

/**
 * 一次性提示「点一下单词会出现横线,再点一次查词」(替换长按提示):挂载时读本机记忆,没看过就显示并马上记下;
 * 这一道题内一直显示,之后每个新实例读到「看过」就不显示。没有 role=status(复习页的结果行是唯一的 status)。
 */
export function TapLookupHint() {
  const { t } = useTranslation();
  const [show] = useState(() => !readTapLookupHintSeen());
  useEffect(() => {
    if (show) writeTapLookupHintSeen();
  }, [show]);
  return show ? <p data-testid="tap-lookup-hint" className="mt-3 text-sub text-ink-2">{t("web.wordbookDefs.after.tapLookupHint")}</p> : null;
}
