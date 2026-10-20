import { LoaderIcon, SquareIcon, Volume2Icon } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { Button } from "@renderer/components/ui/button";
import { loadServerAiConfig, type ServerAiConfig } from "~/api/server-config";
import { useAuth } from "~/auth/auth-context";
import type { PointProps } from "~/lib/extension-points";
import { resolveTtsVoice } from "~/settings/tts-voice-pref";
import { ttsErrorMessage, useTtsPlayer } from "./use-tts-player";

const KEY = "selection";

/**
 * 选词操作条里的「朗读」(扩展点 selectionActions,R-L5)。iOS:`tts.play` 的同步段先 `primeAudioElement` 再 await 合成,
 * 所以必须在点击处理函数里直接调用(中间不能有 await);TTS 配置在挂载时预载,载入前按钮禁用,没有 TTS 模型则不渲染。
 */
export function ReadAloudAction({ text, testId }: PointProps["selectionActions"]) {
  const { api } = useAuth();
  const { t } = useTranslation();
  const tRef = useRef(t);
  tRef.current = t;
  const [ai, setAi] = useState<ServerAiConfig | null | undefined>(undefined); // undefined = loading, null = unavailable
  useEffect(() => {
    let alive = true;
    loadServerAiConfig(api).then((c) => { if (alive) setAi(c.defaultTts.model ? c : null); }, (): void => { if (alive) setAi(null); });
    return () => { alive = false; };
  }, [api]);
  const tts = useTtsPlayer(api, {
    onError: (err) => toast.error(ttsErrorMessage(tRef.current, err)),
    onNothingToRead: () => toast.info(tRef.current("web.chat.nothingToRead")),
  });
  if (ai === null) return null;
  const state = tts.states[KEY] ?? "idle";
  const busy = state === "loading" || state === "playing";
  const click = () => {
    if (busy) { tts.stop(); return; }
    if (!ai) return;
    const voice = resolveTtsVoice("word", ai);
    void tts.play(KEY, text, voice.model, voice.voice); // 同步段内 prime;不要在这之前 await
  };
  const label = busy ? t("web.chat.stopSpeaking") : t("web.chat.speak");
  const Icon = state === "loading" ? LoaderIcon : busy ? SquareIcon : Volume2Icon;
  return (
    <Button variant="ghost" data-testid={testId} data-state={state} aria-label={label} disabled={!ai}
      className="h-11 min-w-11 rounded-full px-3" onClick={click}>
      <Icon className={state === "loading" ? "mr-1.5 h-4 w-4 animate-spin" : "mr-1.5 h-4 w-4"} aria-hidden="true" />{label}
    </Button>
  );
}
