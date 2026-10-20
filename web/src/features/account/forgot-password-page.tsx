import "./locales";
import { useState, type FormEvent } from "react";
import { useTranslation } from "react-i18next";
import { Link, Navigate, useNavigate } from "react-router-dom";
import { translateServerError } from "~/api/error-messages";
import { CaptchaField, useCaptchaGate } from "~/components/captcha";
import { useAuth } from "~/auth/auth-context";
import { normalizeEmail } from "~/auth/validation";
import { ACCOUNT_ERROR_KEYS, resetPassword } from "./account-api";
import { EmailCodeField } from "./email-code-field";

const LABEL = "block text-[13px] font-medium text-ink-2";
const FIELD = "h-12 w-full rounded-button bg-surface-2 px-3.5 text-base text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";

/**
 * 找回密码(两步):邮箱发码 → 验证码 + 新密码。成功后不自动登录,带着「请用新密码登录」的提示回登录页。
 * 文案不暗示邮箱是否已注册。
 */
export function ForgotPasswordPage() {
  const { t } = useTranslation();
  const { api, user } = useAuth();
  const navigate = useNavigate();
  const gate = useCaptchaGate(api, "reset");
  const [email, setEmail] = useState("");
  const [sentEmail, setSentEmail] = useState<string | null>(null);
  const [code, setCode] = useState("");
  const [password, setPassword] = useState("");
  const [note, setNote] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  if (user) return <Navigate to="/practice" replace />;

  function submit(event: FormEvent) {
    event.preventDefault();
    if (sentEmail === null || normalizeEmail(email) !== sentEmail) {
      setError(t("web.account.code.emailChanged"));
      return;
    }
    if (!/^\d{6}$/.test(code)) {
      setError(t("web.account.code.codeInvalid"));
      return;
    }
    if (password.length < 8 || password.length > 128) {
      setError(t("web.login.passwordLength"));
      return;
    }
    if (gate.needed && gate.payload === null) {
      setError(t("web.errors.captchaRequired"));
      return;
    }
    setBusy(true);
    setError(null);
    const captcha = gate.take() ?? undefined;
    resetPassword(api, { email, code, newPassword: password }, captcha)
      .then(() => {
        // 成功后页面即将卸载:不再求解新的载荷。
        gate.consumed(false);
        navigate("/login", { replace: true, state: { notice: "passwordReset" } });
      })
      .catch((err: unknown) => {
        gate.onServerError(err);
        gate.consumed();
        setError(translateServerError(t, err, ACCOUNT_ERROR_KEYS));
      })
      .finally(() => setBusy(false));
  }

  return (
    <div className="flex min-h-[100dvh] flex-col justify-center bg-background px-6 pb-[env(safe-area-inset-bottom)] pt-[env(safe-area-inset-top)] page-bg">
      <div className="mx-auto w-full max-w-sm">
        <h1 className="truncate text-center text-headline font-semibold text-ink">{t("web.account.forgot.title")}</h1>
        <form onSubmit={submit} noValidate className="mt-6 space-y-4 mat-surface-strong liquid:rounded-panel liquid:p-4">
          {gate.needed ? (
            <div className="space-y-2">
              <CaptchaField ref={gate.handleRef} onPayload={gate.setPayload} />
              {gate.ready ? null : <p role="status" aria-live="polite" className="text-meta text-ink-2">{t("web.errors.captchaRequired")}</p>}
            </div>
          ) : null}
          <EmailCodeField
            id="forgot-email"
            value={email}
            onChange={setEmail}
            purpose="reset"
            sent={sentEmail !== null}
            takeCaptcha={gate.take}
            captchaReady={gate.ready}
            onCaptchaUsed={(err) => {
              gate.consumed();
              gate.onServerError(err);
            }}
            onSent={() => {
              setSentEmail(normalizeEmail(email));
              setNote(t("web.account.forgot.note"));
              setError(null);
            }}
            onError={setError}
          />
          {note ? <p data-testid="forgot-note" className="text-meta text-ink-2">{note}</p> : null}
          {sentEmail !== null ? (
            <>
              <div className="space-y-1.5">
                <label htmlFor="forgot-code" className={LABEL}>{t("web.account.code.codeInput")}</label>
                <input id="forgot-code" inputMode="numeric" autoComplete="one-time-code" maxLength={6} value={code}
                  onChange={(e) => setCode(e.target.value)} className={FIELD} />
              </div>
              <div className="space-y-1.5">
                <label htmlFor="forgot-password" className={LABEL}>{t("web.account.forgot.newPassword")}</label>
                <input id="forgot-password" type="password" autoComplete="new-password" value={password}
                  onChange={(e) => setPassword(e.target.value)} className={FIELD} />
              </div>
            </>
          ) : null}
          {error ? <p role="alert" data-testid="forgot-error" className="text-sub text-destructive">{error}</p> : null}
          {sentEmail !== null ? (
            <button type="submit" disabled={busy}
              className="h-12 w-full whitespace-nowrap rounded-button bg-blue text-[15px] font-semibold text-white transition-colors duration-fast disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
              {t("web.account.forgot.submit")}
            </button>
          ) : null}
        </form>
        <div className="mt-5 flex justify-center">
          <Link to="/login" className="tap-link whitespace-nowrap text-sub font-medium text-blue">{t("web.account.forgot.back")}</Link>
        </div>
      </div>
    </div>
  );
}
