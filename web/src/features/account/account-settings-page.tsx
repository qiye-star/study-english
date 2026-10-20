import "./locales";
import { LogOutIcon } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useAuth } from "~/auth/auth-context";
import { LQ_DANGER_TEXT, LQ_PAGE } from "~/components/liquid";
import { PageHeader } from "~/layout/page-header";
import { AccountSection, MyInviteSection } from "./lazy";

/** 我的 → 账号设置(/me/account):资料、邮箱与密码(AccountSection)、邀请码(MyInviteSection),底部退出登录。 */
export function AccountSettingsPage() {
  const { t } = useTranslation();
  const { logout } = useAuth();
  return (
    <div>
      <PageHeader title={t("web.account.pageTitle")} back="/me" />
      <div className={`px-gutter pb-6 ${LQ_PAGE}`}>
        <AccountSection />
        <MyInviteSection />
        <button type="button" data-testid="account-logout" onClick={() => logout(true)}
          className={`mt-[18px] flex h-12 w-full items-center justify-center gap-1.5 rounded-button text-body font-semibold text-red transition-colors duration-fast active:bg-red-tint focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${LQ_DANGER_TEXT} liquid:mx-auto liquid:mt-8 liquid:w-auto liquid:px-6`}>
          <LogOutIcon aria-hidden className="h-5 w-5" />
          {t("web.me.logout")}
        </button>
      </div>
    </div>
  );
}
