import { useCallback, useEffect, useState } from "react";
import { readHintSeen, writeHintSeen } from "./hint-pref";

export const HINT_VISIBLE_MS = 8000;

/**
 * 一次性小提示(spec §2.2、计划 R-15):第一次出现未读时显示并马上记下「已显示」;这一次的显示保持到任意 pointerdown、
 * 点图标、未读归零或 8 秒后;之后同一设备不再出现。
 */
export function useOneTimeHint(unread: number): { show: boolean; dismiss: () => void } {
  const [shown, setShown] = useState(false);
  useEffect(() => {
    if (unread <= 0 || readHintSeen()) return;
    writeHintSeen();
    setShown(true);
  }, [unread]);
  const dismiss = useCallback(() => setShown(false), []);
  const visible = shown && unread > 0;
  useEffect(() => {
    if (!visible) return;
    const timer = window.setTimeout(dismiss, HINT_VISIBLE_MS);
    document.addEventListener("pointerdown", dismiss, { capture: true, once: true });
    return () => {
      window.clearTimeout(timer);
      document.removeEventListener("pointerdown", dismiss, { capture: true });
    };
  }, [visible, dismiss]);
  return { show: visible, dismiss };
}
