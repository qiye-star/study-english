import { GaugeIcon, LanguagesIcon, Volume2Icon } from "lucide-react";
import type { ComponentType, ReactNode, SVGProps } from "react";
import { useTranslation } from "react-i18next";
import { cn } from "~/lib/cn";
import { formatPlaybackRate, nextPlaybackRate, setPlaybackRate, usePlaybackRate } from "~/lib/playback-rate";

/** 设计稿 .toggle:44×26 轨道,开 = 蓝底白钮;只是视觉,状态由外层按钮的 aria-pressed 表达。 */
export function SwitchVisual({ on }: { on: boolean }) {
  return (
    <span aria-hidden className={cn("relative h-[26px] w-11 flex-none rounded-full transition-colors duration-fast",
      on ? "bg-blue" : "bg-surface-2 shadow-hair liquid:bg-wash-2")}>
      <span className={cn("absolute top-0.5 h-[22px] w-[22px] rounded-full transition-[left] duration-fast",
        on ? "left-[20px] bg-white" : "left-0.5 bg-surface shadow-[0_1px_2px_rgba(17,19,24,0.2)]")} />
    </span>
  );
}

export const rowClass = cn(
  "flex min-h-row w-full items-center gap-3 rounded-[10px] px-3 py-2 text-left transition-colors duration-fast liquid:rounded-tile liquid:hover:bg-wash",
  "hover:bg-surface-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50",
);

export function RowText({ icon: Icon, title, subtitle }: { icon: ComponentType<SVGProps<SVGSVGElement>>; title: ReactNode; subtitle?: ReactNode }) {
  return (
    <>
      <Icon aria-hidden className="h-5 w-5 flex-none text-ink-2" />
      <span className="min-w-0 flex-1">
        <span className="block text-body font-medium text-ink">{title}</span>
        {subtitle ? <span className="mt-0.5 block text-meta text-ink-2">{subtitle}</span> : null}
      </span>
    </>
  );
}

/** 本对话的三行选项(双语、自动朗读、语速):旧「调整」弹出面板与新设置面板共用,testid / aria 不变。 */
export interface OptionToggles {
  canTranslate: boolean;
  bilingual: boolean;
  autoSpeak: boolean;
  loaded: boolean;
  bilingualSaving: boolean;
  autoSpeakSaving: boolean;
}

export function OptionRows({ toggles, onToggleBilingual, onToggleAutoSpeak }: {
  toggles: OptionToggles;
  onToggleBilingual(): void;
  onToggleAutoSpeak(): void;
}) {
  const { t } = useTranslation();
  const rate = usePlaybackRate();
  const { canTranslate, bilingual, autoSpeak, loaded, bilingualSaving, autoSpeakSaving } = toggles;
  return (
    <>
      {canTranslate && (
        <button type="button" className={rowClass} data-testid="conversation-bilingual"
          aria-pressed={bilingual} disabled={!loaded || bilingualSaving} onClick={onToggleBilingual}>
          <RowText icon={LanguagesIcon} title={t("web.chat.options.bilingual")} subtitle={t("web.chat.options.bilingualHint")} />
          <SwitchVisual on={bilingual} />
        </button>
      )}
      <button type="button" className={rowClass} data-testid="conversation-autospeak"
        aria-pressed={autoSpeak} disabled={!loaded || autoSpeakSaving} onClick={onToggleAutoSpeak}>
        <RowText icon={Volume2Icon} title={t("web.chat.options.autoSpeak")} subtitle={t("web.chat.options.autoSpeakHint")} />
        <SwitchVisual on={autoSpeak} />
      </button>
      <button type="button" className={rowClass} data-testid="conversation-speed"
        aria-label={t("web.chat.speed.label", { rate: formatPlaybackRate(rate) })} onClick={() => setPlaybackRate(nextPlaybackRate(rate))}>
        <RowText icon={GaugeIcon} title={t("web.chat.options.speed")} />
        <span className="num flex-none rounded-[7px] bg-surface-2 px-2 py-0.5 text-sub font-semibold text-ink">{formatPlaybackRate(rate)}</span>
      </button>
    </>
  );
}
