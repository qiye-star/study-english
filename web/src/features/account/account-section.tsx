import "./locales";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import type { UserProfile } from "~/api/types";
import { useAuth } from "~/auth/auth-context";
import { EMAIL_BINDING_PATH, emailStatusOf } from "~/auth/email-binding";
import { ListRow, SectionGroup } from "~/components/section-group";
import { fetchProfile } from "./account-api";
import { NicknameRow } from "./nickname-row";
import { PasswordSheet } from "./password-sheet";

/** 「我的」页的账号区:昵称、邮箱(脱敏显示,绑定 / 换绑进绑定页)、改密。 */
export function AccountSection() {
  const { t } = useTranslation();
  const { api } = useAuth();
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [passwordOpen, setPasswordOpen] = useState(false);
  const [passwordStatus, setPasswordStatus] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    fetchProfile(api).then((p) => { if (alive) setProfile(p); }).catch(() => { /* 账号区静默降级:昵称留空 */ });
    return () => { alive = false; };
  }, [api]);

  const email = profile ? emailStatusOf(profile) : null;

  return (
    <SectionGroup title={t("web.account.title")} className="mt-4">
      <NicknameRow nickname={profile?.nickname} onSaved={(nickname) => setProfile((p) => (p ? { ...p, nickname } : p))} />
      {email ? (
        <ListRow
          title={t("web.account.email.title")}
          subtitle={email.masked
            ? (email.verified ? t("web.account.email.maskedVerified", { email: email.masked }) : email.masked)
            : t("web.account.email.unbound")}
          value={<span className="whitespace-nowrap">{email.verified ? t("web.account.email.change") : t("web.account.email.bind")}</span>}
          to={EMAIL_BINDING_PATH}
          testId="account-email-open"
        />
      ) : null}
      <ListRow title={t("web.account.password.open")} onClick={() => { setPasswordStatus(null); setPasswordOpen(true); }} testId="account-password-open" />
      {passwordStatus ? (
        <p role="status" data-testid="account-password-status" className="px-3.5 pb-2.5 text-meta text-green">{passwordStatus}</p>
      ) : null}
      <PasswordSheet open={passwordOpen} onOpenChange={setPasswordOpen} onChanged={() => setPasswordStatus(t("web.account.password.changed"))} />
    </SectionGroup>
  );
}
