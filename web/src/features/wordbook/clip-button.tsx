import { Volume2Icon } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useAuth } from "~/auth/auth-context";
import { primeAudioElement } from "~/features/chat";

/** 复习选择题里的原片片段(服务端 `Question.clip`,网页经 ApiClient 转成 camelCase)。只属于用户自己的库条目。 */
export interface ClipRef { itemId: string; startMs: number; endMs: number }

type Phase = "idle" | "loading" | "failed";

/**
 * 「播放原片」(计划 L4 Task 18):点一下取媒体票据(同源 URL,与库播放同一个接口,每次都由服务端重验属主),
 * 从 startMs 播到 endMs 停;再点从头重播。票据失败 → 按钮置灰,不弹提示。卸载时停止。
 * 票据 URL 只放进 <audio>,不写日志、不进 URL 以外的地方。iOS:在点击的同步阶段解锁 <audio>(primeAudioElement)。
 */
export function ClipButton({ clip, testId = "clip-play" }: { clip: ClipRef; testId?: string }) {
  const { t } = useTranslation();
  const { api } = useAuth();
  const [phase, setPhase] = useState<Phase>("idle");
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const sourceRef = useRef<string | null>(null); // the ticket URL, reused until the page goes away
  const aliveRef = useRef(true);

  useEffect(() => {
    aliveRef.current = true;
    return () => {
      aliveRef.current = false;
      audioRef.current?.pause();
    };
  }, []);

  const ensureAudio = (): HTMLAudioElement => {
    if (audioRef.current) return audioRef.current;
    const audio = new Audio();
    audio.preload = "auto";
    // the bounds travel on the element, so one <audio> serves whichever clip the button was last given
    audio.addEventListener("timeupdate", () => {
      if (audio.currentTime * 1000 >= Number(audio.dataset.endMs)) audio.pause();
    });
    audioRef.current = audio;
    return audio;
  };

  const play = (audio: HTMLAudioElement) => {
    audio.currentTime = Number(audio.dataset.startMs) / 1000;
    void audio.play()?.catch((): void => undefined);
  };

  const onClick = () => {
    if (phase === "failed") return;
    const audio = ensureAudio();
    audio.dataset.startMs = String(clip.startMs);
    audio.dataset.endMs = String(clip.endMs);
    if (sourceRef.current) {
      play(audio);
      return;
    }
    primeAudioElement(audio); // unlock inside the tap (iOS); the real source follows once the ticket arrives
    setPhase("loading");
    api.request<{ url: string }>("POST", `/api/library/items/${encodeURIComponent(clip.itemId)}/media-ticket`, { timeoutMs: 15_000 })
      .then((res) => {
        if (!aliveRef.current) return;
        sourceRef.current = res.url;
        audio.src = res.url;
        setPhase("idle");
        play(audio);
      })
      .catch(() => {
        if (aliveRef.current) setPhase("failed");
      });
  };

  return (
    <button type="button" data-testid={testId} disabled={phase === "failed"} aria-busy={phase === "loading"}
      onClick={onClick}
      className="mt-2 inline-flex min-h-tap items-center gap-1.5 rounded-button px-3 text-sub font-semibold text-blue focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-40">
      <Volume2Icon className="size-4" aria-hidden />
      {t("web.wordbook.clip.play")}
    </button>
  );
}
