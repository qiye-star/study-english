import { AudioWaveformIcon } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@renderer/components/ui/button";
import { IconChip } from "~/components/icon-chip";
import { LQ_PAGE } from "~/components/liquid";
import { SectionGroup } from "~/components/section-group";
import { translateServerError } from "~/api/error-messages";
import { loadServerAiConfig, type ServerAiConfig } from "~/api/server-config";
import { useAuth } from "~/auth/auth-context";
import { PageHeader } from "~/layout/page-header";

/** 我的 → 语音服务(/me/services):只读展示服务器提供的语音识别与朗读模型,失败可重试。 */
export function MeServicesPage() {
  const { t } = useTranslation();
  const { api } = useAuth();
  const [ai, setAi] = useState<ServerAiConfig | null>(null);
  const [aiError, setAiError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const tRef = useRef(t);
  tRef.current = t;

  useEffect(() => {
    let alive = true;
    setAiError(null);
    loadServerAiConfig(api)
      .then((config): void => { if (alive) setAi(config); })
      .catch((err): void => { if (alive) setAiError(translateServerError(tRef.current, err)); });
    return () => { alive = false; };
  }, [api, attempt]);

  return (
    <div>
      <PageHeader title={t("web.me.servicesRow")} back="/me" />
      <div className={`px-gutter pb-6 ${LQ_PAGE}`}>
        <SectionGroup title={t("web.me.services")}>
          <div data-testid="services-info" className="flex min-h-row items-start gap-3 py-2.5 pl-3.5 pr-3 liquid:px-4">
            <IconChip tone="gray" icon={AudioWaveformIcon} />
            <div className="min-w-0 flex-1 pt-0.5">
              <div className="space-y-0.5 text-meta text-ink-2">
                <p>{t("web.me.stt")}</p>
                {ai && <p>{t("web.me.tts", { models: ai.ttsModels.join(", ") || "—" })}</p>}
                {ai?.defaultTts.voice && <p>{t("web.me.ttsDefault", { voice: ai.defaultTts.voice })}</p>}
              </div>
              {aiError && (
                <div data-testid="services-error" role="alert" className="mt-1 flex items-center gap-2 text-sub text-destructive">
                  <span className="flex-1">{aiError}</span>
                  <Button variant="outline" size="sm" className="h-tap" onClick={() => setAttempt((n) => n + 1)}>{t("web.common.retry")}</Button>
                </div>
              )}
            </div>
          </div>
        </SectionGroup>
      </div>
    </div>
  );
}
