import "./locales";
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";
import { useAuth } from "~/auth/auth-context";
import { EMAIL_BINDING_PATH } from "~/auth/email-binding";
import { formatDeadline } from "./binding-deadline";

/** 截止前横幅(X26):邮箱绑定待完成时显示截止时间与去绑定的入口。由 lazy.tsx 包一层,非待绑定时不加载。 */
export function PendingBindingBanner() {
  const { t, i18n } = useTranslation();
  const { emailStatus } = useAuth();
  if (emailStatus?.binding.state !== "pending") return null;
  const time = formatDeadline(emailStatus.binding.deadline, i18n.language);
  return (
    <div role="status" data-testid="binding-banner" className="flex items-center gap-3 bg-surface-2 px-4 py-2.5">
      <p className="min-w-0 flex-1 text-sub text-ink">
        {time ? t("web.account.binding.pendingUntil", { time }) : t("web.account.binding.pending")}
      </p>
      <Link to={EMAIL_BINDING_PATH} className="tap-link flex-none whitespace-nowrap text-sub font-semibold text-blue">
        {t("web.account.binding.bindNow")}
      </Link>
    </div>
  );
}
