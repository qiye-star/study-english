import "./locales";
import { useCallback, useState } from "react";
import { useTranslation } from "react-i18next";
import { CHAT_HOME_ROLE_HINT_KEY } from "./chat-home-cache";

function readSeen(): boolean {
  try {
    return window.localStorage.getItem(CHAT_HOME_ROLE_HINT_KEY) === "1";
  } catch {
    return false; // 存储不可用 = 每次显示,不报错
  }
}

/** 新对话的首次使用提示是否还要显示(FR8):永久关闭记在 localStorage(只存 "1")。 */
export function useRoleHint(): { show: boolean; dismiss(): void } {
  const [seen, setSeen] = useState(readSeen);
  const dismiss = useCallback(() => {
    setSeen(true);
    try {
      window.localStorage.setItem(CHAT_HOME_ROLE_HINT_KEY, "1");
    } catch {
      /* 写失败:这次打开内不再显示即可 */
    }
  }, []);
  return { show: !seen, dismiss };
}

/** 设置按钮下方的提示气泡(`role="note"`),放在按钮外层的 relative 容器里。 */
export function RoleHint({ onDismiss }: { onDismiss(): void }) {
  const { t } = useTranslation();
  return (
    <div role="note" data-testid="chat-role-hint"
      className="absolute right-0 top-full z-40 mt-1 w-[min(260px,calc(100vw-32px))] rounded-card border-[0.5px] border-hair bg-surface p-3 text-sub text-ink shadow-[0_12px_32px_-12px_rgba(17,19,24,0.3)]">
      <p>{t("web.chat.home.roleHint.text")}</p>
      <button type="button" data-testid="chat-role-hint-dismiss" onClick={onDismiss}
        className="mt-1 inline-flex min-h-tap items-center rounded-button px-2 font-semibold text-blue focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
        {t("web.chat.home.roleHint.gotIt")}
      </button>
    </div>
  );
}
