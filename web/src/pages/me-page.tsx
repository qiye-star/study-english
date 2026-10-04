import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";
import { Button } from "@renderer/components/ui/button";
import { loadServerAiConfig, type ServerAiConfig } from "~/api/server-config";
import { useAuth } from "~/auth/auth-context";
import { SUPPORTED_LANGUAGES, type UiLanguage } from "~/i18n";
import { PageHeader } from "~/layout/page-header";
import { shouldShowIosInstallHint } from "~/pwa/ios";
import { useSettings } from "~/settings/settings-context";

export function MePage() {
  const { t } = useTranslation();
  const { user, api, logout } = useAuth();
  const { language, setLanguage } = useSettings();
  const [ai, setAi] = useState<ServerAiConfig | null>(null);

  useEffect(() => {
    let alive = true;
    loadServerAiConfig(api).then((config): void => { if (alive) setAi(config); }).catch((): void => undefined);
    return () => { alive = false; };
  }, [api]);

  const showInstall = shouldShowIosInstallHint(
    navigator.userAgent,
    (navigator as Navigator & { standalone?: boolean }).standalone,
    window.matchMedia?.("(display-mode: standalone)").matches ?? false,
  );

  return (
    <div>
      <PageHeader title={t("web.me.title")} />
      <div className="space-y-6 p-4">
        <section>
          <h2 className="text-sm text-muted-foreground">{t("web.me.username")}</h2>
          <p data-testid="me-username" className="text-lg font-medium">{user?.name}</p>
        </section>
        <section className="space-y-2">
          <label htmlFor="language" className="text-sm text-muted-foreground">{t("web.me.language")}</label>
          <select id="language" data-testid="me-language" value={language}
            onChange={(e) => setLanguage(e.target.value as UiLanguage)}
            className="h-11 w-full rounded-md border bg-background px-3 text-base">
            {SUPPORTED_LANGUAGES.map((l) => (
              <option key={l} value={l}>{t(`web.languages.${l}`)}</option>
            ))}
          </select>
          <p className="text-xs text-muted-foreground">{t("web.me.languageHint")}</p>
        </section>
        <section data-testid="me-services" className="space-y-1 text-sm">
          <h2 className="text-sm text-muted-foreground">{t("web.me.services")}</h2>
          <p>{t("web.me.stt")}</p>
          {ai && <p>{t("web.me.tts", { models: ai.ttsModels.join(", ") || "—" })}</p>}
          {ai?.defaultTts.voice && <p>{t("web.me.ttsDefault", { voice: ai.defaultTts.voice })}</p>}
        </section>
        {showInstall && (
          <Button asChild variant="outline" className="h-11 w-full">
            <Link to="/install">{t("web.me.install")}</Link>
          </Button>
        )}
        <Button variant="destructive" data-testid="me-logout" className="h-11 w-full" onClick={() => logout(true)}>
          {t("web.me.logout")}
        </Button>
      </div>
    </div>
  );
}
