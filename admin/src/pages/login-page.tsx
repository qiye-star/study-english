import { useState, type FormEvent } from "react";
import { Navigate, useLocation } from "react-router-dom";
import { login, loginTotp, type LoginResult } from "../api/endpoints";
import { setPendingCsrf, setSession, useAdminSession } from "../api/session";
import { errorText } from "../hooks/use-async";
import { SpinnerIcon } from "../components/icons";
import { S } from "../strings";

/** 登录页的标识:一小段静态波形 */
function Mark() {
  const bars = [4, 10, 18, 26, 14, 30, 22, 12, 20, 8, 4];
  return (
    <svg width="88" height="36" viewBox="0 0 88 36" aria-hidden="true" className="text-accent">
      {bars.map((h, i) => (
        <rect key={i} x={i * 8} y={18 - h / 2} width="4" height={h} rx="2" fill="currentColor" opacity={i === 5 ? 1 : 0.55 + (h / 30) * 0.4} />
      ))}
    </svg>
  );
}

function adopt(result: LoginResult) {
  const { mfaRequired: _mfa, ...session } = result;
  setSession(session);
}

/** 两步登录:账号密码 →(已绑定 TOTP 时)验证码或恢复码。会话 token 在 HttpOnly Cookie 里。 */
export function LoginPage() {
  const session = useAdminSession();
  const location = useLocation();
  const [step, setStep] = useState<"password" | "mfa">("password");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (session) {
    const from = (location.state as { from?: string } | null)?.from;
    return <Navigate to={from && from !== "/login" ? from : "/"} replace />;
  }

  const submitPassword = async () => {
    if (!username.trim() || !password) return setError(S.login.required);
    const res = await login(username.trim(), password);
    setPassword("");
    if (res.mfaRequired) {
      setPendingCsrf(res.csrfToken);
      setStep("mfa");
      setBusy(false);
      return;
    }
    adopt(res);
  };

  const submitCode = async () => {
    if (!code.trim()) return setError(S.login.codeRequired);
    adopt(await loginTotp(code.trim()));
  };

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      await (step === "password" ? submitPassword() : submitCode());
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  };

  const back = () => {
    setPendingCsrf(null);
    setCode("");
    setError(null);
    setStep("password");
  };

  return (
    <div className="flex min-h-dvh flex-col items-center justify-center bg-bg px-5">
      <form onSubmit={submit} className="fade-in w-full max-w-[400px] space-y-6" noValidate>
        <div className="space-y-4">
          <Mark />
          <div>
            <h1 className="text-xl font-semibold tracking-tight">{step === "password" ? S.login.title : S.login.mfaTitle}</h1>
            <p className="mt-1 text-sm text-muted">{step === "password" ? S.login.subtitle : S.login.mfaHint}</p>
          </div>
        </div>
        {step === "password" ? (
          <div className="space-y-4">
            <label className="block space-y-1.5">
              <span className="text-sm font-medium text-fg-2">{S.login.username}</span>
              <input className="field" value={username} onChange={(e) => setUsername(e.target.value)} autoComplete="username" autoCapitalize="none" autoCorrect="off" spellCheck={false} />
            </label>
            <label className="block space-y-1.5">
              <span className="text-sm font-medium text-fg-2">{S.login.password}</span>
              <input className="field" type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" />
            </label>
          </div>
        ) : (
          <label className="block space-y-1.5">
            <span className="text-sm font-medium text-fg-2">{S.login.code}</span>
            <input className="field num" value={code} onChange={(e) => setCode(e.target.value)} autoComplete="one-time-code" autoCapitalize="none" spellCheck={false} autoFocus />
          </label>
        )}
        {error && (
          <p role="alert" className="rounded-lg border border-bad/30 bg-bad-soft px-3 py-2 text-sm text-bad">
            {error}
          </p>
        )}
        <div className="space-y-2">
          <button type="submit" className="btn-primary h-12 w-full text-base" disabled={busy}>
            {busy ? (
              <>
                <SpinnerIcon width={18} height={18} />
                {step === "password" ? S.login.submitting : S.login.verifying}
              </>
            ) : step === "password" ? (
              S.login.submit
            ) : (
              S.login.verify
            )}
          </button>
          {step === "mfa" && (
            <button type="button" className="btn-quiet w-full" onClick={back}>
              {S.login.backToPassword}
            </button>
          )}
        </div>
      </form>
    </div>
  );
}
