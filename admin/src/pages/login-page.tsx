import { useState, type FormEvent } from "react";
import { Navigate, useLocation } from "react-router-dom";
import { login } from "../api/endpoints";
import { saveSession, useToken } from "../api/session";
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

export function LoginPage() {
  const token = useToken();
  const location = useLocation();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (token) {
    const from = (location.state as { from?: string } | null)?.from;
    return <Navigate to={from && from !== "/login" ? from : "/"} replace />;
  }

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (busy) return;
    if (!username.trim() || !password) return setError(S.login.required);
    setBusy(true);
    setError(null);
    try {
      const res = await login(username.trim(), password);
      saveSession({ token: res.token, expires_at: res.expires_at });
    } catch (err) {
      setError(errorText(err));
      setBusy(false);
    }
  };

  return (
    <div className="flex min-h-dvh flex-col items-center justify-center bg-bg px-5" style={{ paddingTop: "env(safe-area-inset-top)", paddingBottom: "env(safe-area-inset-bottom)" }}>
      <form onSubmit={submit} className="fade-in w-full max-w-[400px] space-y-6" noValidate>
        <div className="space-y-4">
          <Mark />
          <div>
            <h1 className="text-xl font-semibold tracking-tight">{S.login.title}</h1>
            <p className="mt-1 text-sm text-muted">{S.login.subtitle}</p>
          </div>
        </div>
        <div className="space-y-4">
          <label className="block space-y-1.5">
            <span className="text-sm font-medium text-fg-2">{S.login.username}</span>
            <input id="login-username" className="field" value={username} onChange={(e) => setUsername(e.target.value)} autoComplete="username" autoCapitalize="none" autoCorrect="off" spellCheck={false} />
          </label>
          <label className="block space-y-1.5">
            <span className="text-sm font-medium text-fg-2">{S.login.password}</span>
            <input id="login-password" className="field" type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" />
          </label>
        </div>
        {error && (
          <p role="alert" className="rounded-lg border border-bad/30 bg-bad-soft px-3 py-2 text-sm text-bad">
            {error}
          </p>
        )}
        <button type="submit" className="btn-primary h-12 w-full text-base" disabled={busy}>
          {busy ? (
            <>
              <SpinnerIcon width={18} height={18} />
              {S.login.submitting}
            </>
          ) : (
            S.login.submit
          )}
        </button>
      </form>
    </div>
  );
}
