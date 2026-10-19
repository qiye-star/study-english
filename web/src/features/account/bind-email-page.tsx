import "./locales";
import { useState, type FormEvent } from "react";
import { useTranslation } from "react-i18next";
import { useLocation, useNavigate } from "react-router-dom";
import { translateServerError } from "~/api/error-messages";
import { useAuth } from "~/auth/auth-context";
import { EMAIL_BINDING_PATH } from "~/auth/email-binding";
import { normalizeEmail } from "~/auth/validation";
import { bindEmail } from "./account-api";
import { formatDeadline } from "./binding-deadline";
import { EmailCodeField } from "./email-code-field";

const LABEL = "block text-[13px] font-medium text-ink-2";
const FIELD = "h-12 w-full rounded-button bg-surface-2 px-3.5 text-base text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";
const NOTE = "text-sub text-ink-2";

/**
 * 绑定邮箱页(X26、W6)。未绑定时只做绑定;已绑定时做换绑(需要当前密码)。
 * 强制绑定时由 RequireAuth 跳到这里(`?required=1`);成功后刷新 /api/me 清除强制标记,回到来源页面。
 * 邮箱与验证码只留在组件状态里,不写 localStorage。
 */
export function BindEmailPage() {
  const { t, i18n } = useTranslation();
  const { api, emailStatus, refreshProfile } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [email, setEmail] = useState("");
  const [sentEmail, setSentEmail] = useState<string | null>(null);
  const [code, setCode] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const verified = emailStatus?.verified === true;
  const binding = emailStatus?.binding;
  const required = new URLSearchParams(location.search).get("required") === "1" || binding?.state === "enforced";
  const from = (location.state as { from?: unknown } | null)?.from;
  const returnTo = typeof from === "string" && from !== EMAIL_BINDING_PATH ? from : "/me";
  const deadline = binding?.state === "pending" ? formatDeadline(binding.deadline, i18n.language) : null;
  const sent = sentEmail !== null;

  function firstProblem(): string | null {
    if (sentEmail === null) return t("web.account.code.emailInvalid");
    if (normalizeEmail(email) !== sentEmail) return t("web.account.code.emailChanged");
    if (!/^\d{6}$/.test(code)) return t("web.account.code.codeInvalid");
    if (verified && password === "") return t("web.account.bind.passwordRequired");
    return null;
  }

  function submit(event: FormEvent) {
    event.preventDefault();
    const problem = firstProblem();
    if (problem) {
      setError(problem);
      return;
    }
    setBusy(true);
    setError(null);
    bindEmail(api, { email, code, ...(verified ? { password } : {}) })
      .then(() => refreshProfile?.())
      .then(() => navigate(returnTo, { replace: true }))
      .catch((err: unknown) => setError(translateServerError(t, err)))
      .finally(() => setBusy(false));
  }

  const note = verified
    ? t("web.account.bind.changeNote", { email: emailStatus?.masked ?? "" })
    : required ? t("web.account.bind.required") : null;

  return (
    <div className="mx-auto w-full max-w-sm px-6 pb-[env(safe-area-inset-bottom)] pt-6">
      <h1 className="truncate text-center text-headline font-semibold text-ink">
        {verified ? t("web.account.bind.changeTitle") : t("web.account.bind.title")}
      </h1>
      <div className="mt-4 space-y-2 text-center">
        {note ? <p data-testid="bind-note" className={NOTE}>{note}</p> : null}
        {deadline ? <p data-testid="bind-deadline" className={NOTE}>{t("web.account.bind.deadline", { time: deadline })}</p> : null}
      </div>
      <form onSubmit={submit} noValidate className="mt-6 space-y-4 mat-surface-strong liquid:rounded-panel liquid:p-4">
        <EmailCodeField
          id="bind-email"
          value={email}
          onChange={setEmail}
          purpose={verified ? "change_email" : "bind"}
          sent={sent}
          onSent={() => {
            setSentEmail(normalizeEmail(email));
            setError(null);
          }}
          onError={setError}
        />
        {sent ? (
          <>
            <div className="space-y-1.5">
              <label htmlFor="bind-code" className={LABEL}>{t("web.account.code.codeInput")}</label>
              <input id="bind-code" inputMode="numeric" autoComplete="one-time-code" maxLength={6} value={code}
                onChange={(e) => setCode(e.target.value)} className={FIELD} />
            </div>
            {verified ? (
              <div className="space-y-1.5">
                <label htmlFor="bind-password" className={LABEL}>{t("web.account.password.current")}</label>
                <input id="bind-password" type="password" autoComplete="current-password" value={password}
                  onChange={(e) => setPassword(e.target.value)} className={FIELD} />
              </div>
            ) : null}
          </>
        ) : null}
        {error ? <p role="alert" data-testid="bind-error" className="text-sub text-destructive">{error}</p> : null}
        {sent ? (
          <button type="submit" disabled={busy}
            className="h-12 w-full whitespace-nowrap rounded-button bg-blue text-[15px] font-semibold text-white transition-colors duration-fast disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
            {verified ? t("web.account.bind.submitChange") : t("web.account.bind.submit")}
          </button>
        ) : null}
      </form>
    </div>
  );
}
