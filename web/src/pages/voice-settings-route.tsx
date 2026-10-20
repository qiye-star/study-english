import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { loadServerAiConfig, type ServerAiConfig } from "~/api/server-config";
import { useAuth } from "~/auth/auth-context";
import { PREVIEW_SENTENCE, ttsErrorMessage, useTtsPlayer } from "~/features/chat";
import { VoiceSettingsPage } from "~/features/voice-settings";

/** 我的 → 朗读音色(/me/voice):取服务端 TTS 配置,把 features/chat 的试听播放器交给 VoiceSettingsPage(feature 之间不直接引用)。 */
export function VoiceSettingsRoute() {
  const { api } = useAuth();
  const { t } = useTranslation();
  const tRef = useRef(t);
  tRef.current = t;
  const [ai, setAi] = useState<ServerAiConfig | null | undefined>(undefined);
  useEffect(() => {
    let alive = true;
    loadServerAiConfig(api).then((c) => { if (alive) setAi(c); }, (): void => { if (alive) setAi(null); });
    return () => { alive = false; };
  }, [api]);
  const player = useTtsPlayer(api, { onError: (err) => toast.error(ttsErrorMessage(tRef.current, err)) });
  return <VoiceSettingsPage ai={ai} player={player} sample={PREVIEW_SENTENCE} />;
}
