import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { loadServerAiConfig, voicesFor, type ServerAiConfig } from "~/api/server-config";
import { useAuth } from "~/auth/auth-context";
import { ttsErrorMessage, useTtsPlayer } from "~/features/chat";

/**
 * 背单词的朗读(spec §11.4):复用对话页的 useTtsPlayer 与共享缓存,默认 TTS 模型 / 声音取自服务端配置。
 * accent 指定美 / 英音时优先选该口音的声音,没有就用默认声音。未配置 TTS 时 available 为 false。
 */
export function useSpeaker() {
  const { t } = useTranslation();
  const { api } = useAuth();
  const [ai, setAi] = useState<ServerAiConfig | null>(null);
  const [failed, setFailed] = useState(false);
  const tRef = useRef(t);
  tRef.current = t;
  useEffect(() => {
    let alive = true;
    loadServerAiConfig(api).then((c) => { if (alive) setAi(c); }, (): void => { if (alive) setFailed(true); });
    return () => { alive = false; };
  }, [api]);
  const tts = useTtsPlayer(api, { onError: (err) => toast.error(ttsErrorMessage(tRef.current, err)) });
  const model = ai?.defaultTts.model ?? "";
  const available = Boolean(model);
  const listen = (id: string, text: string, accent?: "us" | "gb") => {
    if (!ai || !model || !text.trim()) return;
    const voice = (accent ? voicesFor(ai, model, { accent })[0]?.value : undefined) ?? ai.defaultTts.voice;
    void tts.play(id, text, model, voice);
  };
  /** 正在加载或播放的朗读 id */
  const active = Object.entries(tts.states).find(([, s]) => s === "loading" || s === "playing")?.[0] ?? null;
  return { available, loading: !ai && !failed, listen, active, prime: tts.prime, stop: tts.stop };
}

export type Speaker = ReturnType<typeof useSpeaker>;
