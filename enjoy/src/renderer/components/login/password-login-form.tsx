import { Button, Input, Label, toast } from "@renderer/components/ui";
import { useContext, useState } from "react";
import { AppSettingsProviderContext } from "@renderer/context";
import { t } from "i18next";

export const PasswordLoginForm = () => {
  const { login, webApi } = useContext(AppSettingsProviderContext);
  const [mode, setMode] = useState<"login" | "register">("login");
  const [username, setUsername] = useState<string>("");
  const [password, setPassword] = useState<string>("");
  const [inviteCode, setInviteCode] = useState<string>("");
  const [submitting, setSubmitting] = useState<boolean>(false);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!webApi) return;

    setSubmitting(true);
    try {
      const user =
        mode === "login"
          ? await webApi.auth({ provider: "password", username, password })
          : await webApi.register({
              username,
              password,
              inviteCode: inviteCode || undefined,
            });
      if (user?.id && user?.accessToken) login(user);
    } catch (err) {
      toast.error(err.message);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <form className="w-full" onSubmit={submit}>
      <div className="w-full grid gap-4 mb-6">
        <div className="grid gap-2">
          <Label htmlFor="username">{t("authUsername")}</Label>
          <Input
            id="username"
            className="h-10"
            autoComplete="username"
            required
            value={username}
            onChange={(e) => setUsername(e.target.value)}
          />
        </div>
        <div className="grid gap-2">
          <Label htmlFor="password">{t("authPassword")}</Label>
          <Input
            id="password"
            className="h-10"
            type="password"
            autoComplete={mode === "login" ? "current-password" : "new-password"}
            required
            minLength={mode === "register" ? 8 : undefined}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </div>
        {mode === "register" && (
          <div className="grid gap-2">
            <Label htmlFor="invite-code">{t("authInviteCode")}</Label>
            <Input
              id="invite-code"
              className="h-10"
              value={inviteCode}
              onChange={(e) => setInviteCode(e.target.value)}
            />
          </div>
        )}
      </div>
      <Button
        type="submit"
        className="w-full"
        size="lg"
        data-testid="password-login-submit"
        disabled={submitting || !username || !password}
      >
        {mode === "login" ? t("login") : t("authRegister")}
      </Button>
      <Button
        type="button"
        variant="link"
        className="w-full mt-2"
        onClick={() => setMode(mode === "login" ? "register" : "login")}
      >
        {mode === "login" ? t("authSwitchToRegister") : t("authSwitchToLogin")}
      </Button>
    </form>
  );
};
