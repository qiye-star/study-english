import { MicIcon } from "lucide-react";
import { useState, type FormEvent } from "react";
import { useTranslation } from "react-i18next";
import { Navigate, useLocation, useNavigate } from "react-router-dom";
import { Button } from "@renderer/components/ui/button";
import { Input } from "@renderer/components/ui/input";
import { Label } from "@renderer/components/ui/label";
import { translateServerError } from "~/api/error-messages";
import { useAuth } from "~/auth/auth-context";
import { validateCredentials } from "~/auth/validation";

const LABEL = "text-sub font-medium text-ink-2";
/** 48px 输入框:surface-2 底、无边框,聚焦时蓝色描边;16px 字号避免 iOS 聚焦缩放 */
const FIELD = "h-12 rounded-button border-0 bg-surface-2 px-3.5 text-base text-ink shadow-none focus-visible:ring-2 focus-visible:ring-blue focus-visible:ring-offset-0";

export function LoginPage() {
  const { t } = useTranslation();
  const { user, login, register } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [mode, setMode] = useState<"login" | "register">("login");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [inviteCode, setInviteCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const from = (location.state as { from?: string } | null)?.from ?? "/practice";

  if (user) return <Navigate to={from} replace />;

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const problem = validateCredentials(mode, username, password);
    if (problem) {
      setError(t(problem));
      return;
    }
    setBusy(true);
    setError(null);
    try {
      if (mode === "login") await login(username, password);
      else await register(username, password, inviteCode.trim() || undefined);
      navigate(from, { replace: true });
    } catch (err) {
      setError(translateServerError(t, err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex min-h-[100dvh] flex-col justify-center bg-background px-6 pb-[env(safe-area-inset-bottom)] pt-[env(safe-area-inset-top)]">
      <div className="mx-auto w-full max-w-sm">
        <div className="mb-8 flex flex-col items-center text-center">
          <span aria-hidden className="flex h-[60px] w-[60px] items-center justify-center rounded-sheet bg-blue-tint text-blue">
            <MicIcon className="h-7 w-7" />
          </span>
          <h1 className="mt-4 text-headline font-semibold text-ink">{t("web.appName")}</h1>
          <p className="mt-1 text-sub text-ink-2">{t("web.login.tagline")}</p>
        </div>
        <form onSubmit={submit} className="space-y-4" noValidate>
          <div className="space-y-1.5">
            <Label htmlFor="username" className={LABEL}>{t("web.login.username")}</Label>
            <Input id="username" data-testid="login-username" autoComplete="username" autoCapitalize="none"
              autoCorrect="off" spellCheck={false} className={FIELD} value={username}
              onChange={(e) => setUsername(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="password" className={LABEL}>{t("web.login.password")}</Label>
            <Input id="password" data-testid="login-password" type="password"
              autoComplete={mode === "login" ? "current-password" : "new-password"}
              className={FIELD} value={password} onChange={(e) => setPassword(e.target.value)} />
          </div>
          {mode === "register" && (
            <div className="space-y-1.5">
              <Label htmlFor="invite" className={LABEL}>{t("web.login.inviteCode")}</Label>
              <Input id="invite" data-testid="register-invite" autoCapitalize="none" autoComplete="off" inputMode="text" className={FIELD}
                value={inviteCode} onChange={(e) => setInviteCode(e.target.value)} />
              <p className="text-meta text-ink-2">{t("web.login.inviteHint")}</p>
            </div>
          )}
          {error && (
            <p role="alert" data-testid="login-error" className="text-sub text-destructive">{error}</p>
          )}
          <Button type="submit" data-testid="login-submit" className="!mt-6 h-12 w-full rounded-button text-body font-semibold" disabled={busy}>
            {mode === "login" ? t("web.login.submit") : t("web.login.registerSubmit")}
          </Button>
        </form>
        <div className="mt-5 flex justify-center">
          <button type="button" data-testid="login-mode-toggle" className="tap-link text-sub font-medium text-blue"
            onClick={() => { setMode(mode === "login" ? "register" : "login"); setError(null); }}>
            {mode === "login" ? t("web.login.switchToRegister") : t("web.login.switchToLogin")}
          </button>
        </div>
      </div>
    </div>
  );
}
