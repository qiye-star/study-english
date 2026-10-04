import { useState, type FormEvent } from "react";
import { useTranslation } from "react-i18next";
import { Navigate, useLocation, useNavigate } from "react-router-dom";
import { Button } from "@renderer/components/ui/button";
import { Input } from "@renderer/components/ui/input";
import { Label } from "@renderer/components/ui/label";
import { translateServerError } from "~/api/error-messages";
import { useAuth } from "~/auth/auth-context";
import { validateCredentials } from "~/auth/validation";

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
    <div className="flex min-h-[100dvh] flex-col justify-center px-6 pb-[env(safe-area-inset-bottom)] pt-[env(safe-area-inset-top)]">
      <h1 className="mb-8 text-center text-2xl font-semibold">{t("web.appName")}</h1>
      <form onSubmit={submit} className="space-y-4" noValidate>
        <div className="space-y-2">
          <Label htmlFor="username">{t("web.login.username")}</Label>
          <Input id="username" data-testid="login-username" autoComplete="username" autoCapitalize="none"
            autoCorrect="off" spellCheck={false} className="h-11 text-base" value={username}
            onChange={(e) => setUsername(e.target.value)} />
        </div>
        <div className="space-y-2">
          <Label htmlFor="password">{t("web.login.password")}</Label>
          <Input id="password" data-testid="login-password" type="password"
            autoComplete={mode === "login" ? "current-password" : "new-password"}
            className="h-11 text-base" value={password} onChange={(e) => setPassword(e.target.value)} />
        </div>
        {mode === "register" && (
          <div className="space-y-2">
            <Label htmlFor="invite">{t("web.login.inviteCode")}</Label>
            <Input id="invite" data-testid="register-invite" autoCapitalize="none" className="h-11 text-base"
              value={inviteCode} onChange={(e) => setInviteCode(e.target.value)} />
            <p className="text-xs text-muted-foreground">{t("web.login.inviteHint")}</p>
          </div>
        )}
        {error && (
          <p role="alert" data-testid="login-error" className="text-sm text-destructive">{error}</p>
        )}
        <Button type="submit" data-testid="login-submit" className="h-11 w-full" disabled={busy}>
          {mode === "login" ? t("web.login.submit") : t("web.login.registerSubmit")}
        </Button>
      </form>
      <Button type="button" variant="link" data-testid="login-mode-toggle" className="mt-4 min-h-11"
        onClick={() => { setMode(mode === "login" ? "register" : "login"); setError(null); }}>
        {mode === "login" ? t("web.login.switchToRegister") : t("web.login.switchToLogin")}
      </Button>
    </div>
  );
}
