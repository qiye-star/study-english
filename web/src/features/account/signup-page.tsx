import "./locales";
import { useEffect, useState, type FormEvent } from "react";
import { useTranslation } from "react-i18next";
import { Link, Navigate, useNavigate } from "react-router-dom";
import { translateServerError } from "~/api/error-messages";
import { CaptchaField, useCaptchaGate } from "~/components/captcha";
import { ACCOUNT_ERROR_KEYS } from "./account-api";
import { useAuth } from "~/auth/auth-context";
import { normalizeEmail, validateCredentials } from "~/auth/validation";
import { EmailCodeField } from "./email-code-field";
import { readInviteFragment } from "./invites/invite-link";

const LABEL = "block text-[13px] font-medium text-ink-2";
const FIELD = "h-12 w-full rounded-button bg-surface-2 px-3.5 text-base text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";
const NICKNAME_MAX = 20;

/**
 * 注册页(R-F13):单页两步。第一步填邮箱并发码;第二步填验证码、用户名、昵称、密码;邀请码始终可选。
 * 邀请码可经 `#invite=CODE` 带入:挂载时读取后立即清掉片段(X27),不进 query、日志或存储。
 */
export function RegisterPage() {
  const { t } = useTranslation();
  const { user, register, api } = useAuth();
  const navigate = useNavigate();
  const gate = useCaptchaGate(api, "register");
  const [email, setEmail] = useState("");
  const [sentEmail, setSentEmail] = useState<string | null>(null);
  const [code, setCode] = useState("");
  const [username, setUsername] = useState("");
  const [nickname, setNickname] = useState("");
  const [password, setPassword] = useState("");
  const [inviteCode, setInviteCode] = useState("");
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    // X27:只读片段;合法的码规范化后填入,无论是否合法都清掉片段(不进 query、日志或存储)。
    const hash = window.location.hash;
    if (!new URLSearchParams(hash.slice(1)).has("invite")) return;
    const code = readInviteFragment(hash);
    if (code) setInviteCode(code);
    window.history.replaceState(window.history.state, "", `${window.location.pathname}${window.location.search}`);
  }, []);

  if (user) return <Navigate to="/practice" replace />;

  const sent = sentEmail !== null;

  function submit(event: FormEvent) {
    event.preventDefault();
    const problem = firstProblem();
    if (problem) {
      setError(problem);
      return;
    }
    if (gate.needed && gate.payload === null) {
      setError(t("web.errors.captchaRequired"));
      return;
    }
    setBusy(true);
    setError(null);
    const captcha = gate.take() ?? undefined;
    register({
      username,
      password,
      email: normalizeEmail(email),
      emailCode: code,
      nickname: nickname.trim(),
      inviteCode: inviteCode.trim() || undefined,
    }, captcha)
      .then(() => {
        // 成功后页面即将卸载:不再求解新的载荷。
        gate.consumed(false);
        navigate("/practice", { replace: true });
      })
      .catch((err: unknown) => {
        gate.onServerError(err);
        gate.consumed();
        setError(translateServerError(t, err, ACCOUNT_ERROR_KEYS));
      })
      .finally(() => setBusy(false));
  }

  function firstProblem(): string | null {
    if (sentEmail === null) return t("web.account.code.emailInvalid");
    if (normalizeEmail(email) !== sentEmail) return t("web.account.code.emailChanged");
    if (!/^\d{6}$/.test(code)) return t("web.account.code.codeInvalid");
    const credentials = validateCredentials("register", username, password);
    if (credentials) return t(credentials);
    const name = nickname.trim();
    if (name.length < 1 || [...name].length > NICKNAME_MAX) return t("web.account.register.errors.nicknameInvalid");
    return null;
  }

  return (
    <div className="flex min-h-[100dvh] flex-col justify-center bg-background px-6 pb-[env(safe-area-inset-bottom)] pt-[env(safe-area-inset-top)] page-bg">
      <div className="mx-auto w-full max-w-sm">
        <h1 className="truncate text-center text-headline font-semibold text-ink">{t("web.account.register.title")}</h1>
        <form onSubmit={submit} noValidate className="mt-6 space-y-4 mat-surface-strong liquid:rounded-panel liquid:p-4">
          {gate.needed ? (
            <div className="space-y-2">
              <CaptchaField ref={gate.handleRef} onPayload={gate.setPayload} />
              {gate.ready ? null : <p role="status" aria-live="polite" className="text-meta text-ink-2">{t("web.errors.captchaRequired")}</p>}
            </div>
          ) : null}
          <EmailCodeField
            id="register-email"
            value={email}
            onChange={setEmail}
            purpose="register"
            sent={sent}
            takeCaptcha={gate.take}
            captchaReady={gate.ready}
            onCaptchaUsed={(err) => {
              gate.consumed();
              gate.onServerError(err);
            }}
            onSent={() => {
              setSentEmail(normalizeEmail(email));
              setNotice(t("web.account.register.codeSent"));
              setError(null);
            }}
            onError={setError}
          />
          {notice ? <p data-testid="register-code-note" className="text-meta text-ink-2">{notice}</p> : null}
          {sent ? (
            <>
              <div className="space-y-1.5">
                <label htmlFor="register-code" className={LABEL}>{t("web.account.code.codeInput")}</label>
                <input id="register-code" inputMode="numeric" autoComplete="one-time-code" maxLength={6} value={code}
                  onChange={(e) => setCode(e.target.value)} className={FIELD} />
              </div>
              <div className="space-y-1.5">
                <label htmlFor="register-username" className={LABEL}>{t("web.account.register.username")}</label>
                <input id="register-username" autoComplete="username" autoCapitalize="none" autoCorrect="off" spellCheck={false}
                  value={username} onChange={(e) => setUsername(e.target.value)} className={FIELD} />
              </div>
              <div className="space-y-1.5">
                <label htmlFor="register-nickname" className={LABEL}>{t("web.account.register.nickname")}</label>
                <input id="register-nickname" autoComplete="nickname" value={nickname} onChange={(e) => setNickname(e.target.value)} className={FIELD} />
                <p className="text-meta text-ink-2">{t("web.account.register.nicknameHint")}</p>
              </div>
              <div className="space-y-1.5">
                <label htmlFor="register-password" className={LABEL}>{t("web.account.register.password")}</label>
                <input id="register-password" type="password" autoComplete="new-password" value={password}
                  onChange={(e) => setPassword(e.target.value)} className={FIELD} />
                <p className="text-meta text-ink-2">{t("web.account.register.passwordHint")}</p>
              </div>
            </>
          ) : null}
          <div className="space-y-1.5">
            <label htmlFor="register-invite" className={LABEL}>{t("web.account.register.invite")}</label>
            <input id="register-invite" autoCapitalize="none" autoComplete="off" value={inviteCode}
              onChange={(e) => setInviteCode(e.target.value)} className={FIELD} />
          </div>
          {error ? <p role="alert" data-testid="register-error" className="text-sub text-destructive">{error}</p> : null}
          {sent ? (
            <button type="submit" disabled={busy}
              className="h-12 w-full whitespace-nowrap rounded-button bg-blue text-[15px] font-semibold text-white transition-colors duration-fast disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
              {t("web.account.register.submit")}
            </button>
          ) : null}
        </form>
        <div className="mt-5 flex justify-center">
          <Link to="/login" className="tap-link whitespace-nowrap text-sub font-medium text-blue">{t("web.account.register.login")}</Link>
        </div>
      </div>
    </div>
  );
}
