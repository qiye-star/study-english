import { CheckIcon, LoaderIcon, PlayIcon, SquareIcon } from "lucide-react";
import { useContext, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import type { VoiceOption } from "~/api/server-config";
import { AuthContext } from "~/auth/auth-context";
import { cn } from "@renderer/lib/utils";
import type { TtsCache } from "./tts";
import { ttsErrorMessage, useTtsPlayer } from "./use-tts-player";

/** 试听固定用的句子 */
export const PREVIEW_SENTENCE = "Hi, nice to meet you. How is your day going?";

type AccentTab = "all" | "us" | "gb";

/**
 * 音色选择器:口音分段(全部/美式/英式)、每个音色一个试听按钮(不会选中它)、点击行才选中。
 * 试听走 /api/ai/audio/speech,由 useTtsPlayer 保证同一时刻只播一个、再点一次停止、按音色缓存 blob(内存)。
 * `settings-tts-voice` 标在"当前选中音色"的展示上(data-value 为音色 id)。
 */
export function VoicePicker({ voices, model, value, onChange, cache, createAudio }: {
  voices: VoiceOption[];
  model: string;
  value: string;
  onChange(value: string): void;
  cache?: TtsCache;
  createAudio?: () => HTMLAudioElement;
}) {
  const { t } = useTranslation();
  const api = useContext(AuthContext)?.api ?? null;
  const [tab, setTab] = useState<AccentTab>("all");
  const tRef = useRef(t);
  tRef.current = t;
  // 没有 api(未登录/测试)时用占位客户端:预览按钮禁用,不会真的发请求
  const player = useTtsPlayer(api ?? ({} as never), {
    ...(cache ? { cache } : {}),
    ...(createAudio ? { createAudio } : {}),
    onError: (err) => toast.error(ttsErrorMessage(tRef.current, err)),
  });

  const hasAccents = voices.some((v) => v.accent === "us" || v.accent === "gb");
  const shown = hasAccents && tab !== "all" ? voices.filter((v) => v.accent === tab) : voices;
  const selected = voices.find((v) => v.value === value);
  const name = (v: VoiceOption) => v.label.split(" (")[0];
  const tabs: AccentTab[] = ["all", "us", "gb"];

  return (
    <div className="space-y-2.5">
      <div className="flex min-h-tap items-center justify-between gap-2">
        <span className="text-sub font-semibold text-ink">{t("web.chat.voicePicker.label")}</span>
        <span data-testid="settings-tts-voice" data-value={value} className="truncate text-sub font-medium text-blue">{selected?.label ?? value}</span>
      </div>
      {hasAccents && (
        // 分段样式(轨道 + 选中片),语义沿用一组 aria-pressed 按钮;32 视觉 / 44 命中
        <div role="group" aria-label={t("web.chat.voicePicker.accentFilter")} className="flex gap-0.5 rounded-badge bg-seg-track p-[3px]">
          {tabs.map((id) => (
            <button key={id} type="button" data-testid={`voice-accent-${id}`} aria-pressed={tab === id}
              className={cn(
                "hit-expand h-8 flex-1 rounded-lg border-[0.5px] text-sub transition-colors duration-fast focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                tab === id ? "border-hair-2 bg-seg-on font-semibold text-ink shadow-seg" : "border-transparent font-medium text-ink-2",
              )}
              onClick={() => setTab(id)}>
              {t(`web.chat.voicePicker.${id}`)}
            </button>
          ))}
        </div>
      )}
      {shown.length === 0 ? (
        <p className="py-3 text-center text-meta text-ink-2">{t("web.chat.voicePicker.empty")}</p>
      ) : (
        <div role="radiogroup" aria-label={t("web.chat.voicePicker.label")}
          className="max-h-72 divide-y-[0.5px] divide-hair-2 overflow-y-auto rounded-card border-[0.5px] border-hair bg-surface">
          {shown.map((v) => {
            const key = `preview:${v.value}`;
            const state = player.states[key] ?? "idle";
            const active = state === "playing" || state === "loading";
            const checked = v.value === value;
            return (
              <div key={v.value} className="flex items-center pr-1.5">
                <button type="button" role="radio" aria-checked={checked} data-testid={`voice-option-${v.value}`}
                  className="flex min-h-row min-w-0 flex-1 items-center gap-2.5 pl-3.5 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
                  onClick={() => onChange(v.value)}>
                  <span className="flex size-[18px] shrink-0 items-center justify-center text-blue">{checked && <CheckIcon className="size-[18px]" aria-hidden />}</span>
                  <span className={cn("truncate text-body", checked ? "font-semibold text-ink" : "text-ink")}>{v.label}</span>
                </button>
                <button type="button" data-testid={`voice-preview-${v.value}`} data-state={state} disabled={!api}
                  aria-label={t(active ? "web.chat.voicePicker.stopPreview" : "web.chat.voicePicker.preview", { name: name(v) })}
                  className={cn("flex size-11 shrink-0 items-center justify-center rounded-full transition-colors duration-fast focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-40",
                    active ? "bg-blue-tint text-blue" : "text-ink-2 hover:bg-surface-2")}
                  onClick={() => void player.play(key, PREVIEW_SENTENCE, model, v.value)}>
                  {state === "loading" ? <LoaderIcon className="size-[18px] animate-spin" aria-hidden />
                    : state === "playing" ? <SquareIcon className="size-4 fill-current" aria-hidden /> : <PlayIcon className="size-[18px] fill-current" aria-hidden />}
                </button>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
