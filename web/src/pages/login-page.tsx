import { MicIcon } from "lucide-react";
import { forwardRef, lazy, Suspense, useState, type FormEvent } from "react";
import { useTranslation } from "react-i18next";
import { Link, Navigate, useLocation, useNavigate } from "react-router-dom";
import { Button } from "@renderer/components/ui/button";
import { Input } from "@renderer/components/ui/input";
import { Label } from "@renderer/components/ui/label";
import { translateServerError } from "~/api/error-messages";
import type { CaptchaFieldProps } from "~/components/captcha/captcha-field";
import type { CaptchaHandle } from "~/components/captcha/captcha-widget";
import { loadCaptchaField } from "~/components/captcha/loaders";
import { useCaptchaGate } from "~/components/captcha/use-captcha-gate";
import { useAuth } from "~/auth/auth-context";
import { validateCredentials } from "~/auth/validation";

const LABEL = "text-[13px] font-medium text-ink-2"; // 经 cn 合并:用任意值字号,避免与颜色类冲突
/** 48px 输入框:surface-2 底、无边框,聚焦时蓝色描边;16px 字号避免 iOS 聚焦缩放 */
const FIELD = "h-12 rounded-button border-0 bg-surface-2 px-3.5 text-base text-ink shadow-none focus-visible:ring-2 focus-visible:ring-blue focus-visible:ring-offset-0 liquid:h-11 liquid:rounded-full liquid:border-0 liquid:bg-wash liquid:shadow-well liquid:focus-visible:ring-blue/35";
const LINK = "tap-link whitespace-nowrap text-sub font-medium text-blue";
// 外壳与其文案只在需要时加载(主包只保留 hook;W7 的 X37/预算做法)。组件本体再由外壳懒加载。
// 外壳分块加载失败(部署后 hash 变了、断网)时:复用既有的通用文案与按钮,不新增字符串;重试即重新加载页面。
// 登录表单本身保持挂载;mode=off 或 adaptive 且未收到 428 时根本不加载外壳,所以不受影响。
const CaptchaUnavailable = forwardRef<CaptchaHandle, CaptchaFieldProps>(function CaptchaUnavailable() {
  const { t } = useTranslation();
  return (
    <div role="alert" className="flex flex-col items-start gap-2">
      <p className="text-sub text-destructive">{t("web.common.loadFailed")}</p>
      <Button type="button" onClick={() => window.location.reload()}>{t("web.common.retry")}</Button>
    </div>
  );
});
const CaptchaField = lazy(() => loadCaptchaField().catch(() => ({ default: CaptchaUnavailable })));

export function LoginPage() {
  const { t } = useTranslation();
  const { user, login, api } = useAuth();
  const navigate = useNavigate();
  // 登录:adaptive 只有收到 428 才出现组件;always 一开始就出现(spec R-C1、R-C12)。
  const gate = useCaptchaGate(api, "login");
  const location = useLocation();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const state = location.state as { from?: string; notice?: string } | null;
  const from = state?.from ?? "/practice";

  if (user) return <Navigate to={from} replace />;

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const problem = validateCredentials("login", username, password);
    if (problem) {
      setError(t(problem));
      return;
    }
    if (gate.needed && gate.payload === null) {
      setError(t("web.errors.captchaRequired"));
      return;
    }
    setBusy(true);
    setError(null);
    const captcha = gate.take() ?? undefined;
    try {
      await login(username, password, captcha);
      gate.consumed(false);
      navigate(from, { replace: true });
    } catch (err) {
      gate.onServerError(err);
      gate.consumed();
      setError(translateServerError(t, err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex min-h-[100dvh] flex-col justify-center bg-background px-6 pb-[env(safe-area-inset-bottom)] pt-[env(safe-area-inset-top)] page-bg">
      <div className="mx-auto w-full max-w-sm">
        <div className="mb-8 flex flex-col items-center text-center">
          <span aria-hidden className="flex h-[60px] w-[60px] items-center justify-center rounded-sheet bg-blue-tint text-blue well liquid:rounded-full liquid:text-ink">
            <MicIcon className="h-7 w-7" />
          </span>
          <h1 className="mt-4 text-headline font-semibold text-ink">{t("web.appName")}</h1>
          <p className="mt-1 text-sub text-ink-2">{t("web.login.tagline")}</p>
        </div>
        {state?.notice === "passwordReset" ? (
          <p role="status" data-testid="login-notice" className="mb-4 text-center text-sub text-green">{t("web.login.passwordReset")}</p>
        ) : null}
        <form onSubmit={submit} className="space-y-4 mat-surface-strong liquid:rounded-panel liquid:p-4" noValidate>
          <div className="space-y-1.5">
            <Label htmlFor="username" className={LABEL}>{t("web.login.usernameOrEmail")}</Label>
            <Input id="username" data-testid="login-username" autoComplete="username" autoCapitalize="none"
              autoCorrect="off" spellCheck={false} className={FIELD} value={username}
              onChange={(e) => setUsername(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="password" className={LABEL}>{t("web.login.password")}</Label>
            <Input id="password" data-testid="login-password" type="password" autoComplete="current-password"
              className={FIELD} value={password} onChange={(e) => setPassword(e.target.value)} />
          </div>
          {gate.needed ? (
            <Suspense fallback={null}>
              <CaptchaField ref={gate.handleRef} onPayload={gate.setPayload} />
            </Suspense>
          ) : null}
          {error && (
            <p role="alert" data-testid="login-error" className="text-sub text-destructive">{error}</p>
          )}
          <Button type="submit" data-testid="login-submit" className="!mt-6 h-12 w-full rounded-button text-[15px] font-semibold liquid:!rounded-full liquid:shadow-accent" disabled={busy}>
            {t("web.login.submit")}
          </Button>
        </form>
        <div className="mt-5 flex flex-col items-center gap-3">
          <Link to="/forgot-password" className={LINK}>{t("web.login.forgotPassword")}</Link>
          <Link to="/register" className={LINK}>{t("web.login.createAccount")}</Link>
        </div>
      </div>
    </div>
  );
}
