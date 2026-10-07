import * as PopoverPrimitive from "@radix-ui/react-popover";
import { ChevronRightIcon, ClipboardListIcon, GaugeIcon, LanguagesIcon, PhoneIcon, Settings2Icon, SlidersHorizontalIcon, Volume2Icon } from "lucide-react";
import { useRef, useState, type ComponentType, type ReactNode, type Ref, type SVGProps } from "react";
import { useTranslation } from "react-i18next";
import { cn } from "./cn";
import { IconButton } from "~/components/icon-button";
import { formatPlaybackRate, nextPlaybackRate, setPlaybackRate, usePlaybackRate } from "~/lib/playback-rate";

/** 设计稿 .toggle:44×26 轨道,开 = 蓝底白钮;只是视觉,状态由外层按钮的 aria-pressed 表达。 */
function SwitchVisual({ on }: { on: boolean }) {
  return (
    <span aria-hidden className={cn("relative h-[26px] w-11 flex-none rounded-full transition-colors duration-fast",
      on ? "bg-blue" : "bg-surface-2 shadow-hair")}>
      <span className={cn("absolute top-0.5 h-[22px] w-[22px] rounded-full transition-[left] duration-fast",
        on ? "left-[20px] bg-white" : "left-0.5 bg-surface shadow-[0_1px_2px_rgba(17,19,24,0.2)]")} />
    </span>
  );
}

const rowClass = cn(
  "flex min-h-row w-full items-center gap-3 rounded-[10px] px-3 py-2 text-left transition-colors duration-fast",
  "hover:bg-surface-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50",
);

function RowText({ icon: Icon, title, subtitle }: { icon: ComponentType<SVGProps<SVGSVGElement>>; title: ReactNode; subtitle?: ReactNode }) {
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

/**
 * R21:对话页顶栏右侧。设计稿只放两个图标:通话(蓝)与"调整"(自动朗读开着时带蓝点)。
 * 双语、自动朗读、语速、复盘、对话设置收进"调整"弹出的选项面板(各自的 data-testid、aria-pressed 与行为不变;
 * 开关类点了不关面板,复盘/设置点了先关面板再开抽屉)。通话入口:服务端开启且浏览器支持时才显示。
 */
export function ConversationHeaderActions({
  canTranslate, bilingual, autoSpeak, loaded, bilingualSaving, autoSpeakSaving, onToggleBilingual, onToggleAutoSpeak, onOpenSettings, onOpenRecap,
  canCall, callDisabled, callBlockedReason, onCall, callButtonRef,
}: {
  canTranslate: boolean;
  bilingual: boolean;
  autoSpeak: boolean;
  loaded: boolean;
  bilingualSaving: boolean;
  autoSpeakSaving: boolean;
  onToggleBilingual(): void;
  onToggleAutoSpeak(): void;
  onOpenSettings(): void;
  onOpenRecap(): void;
  canCall: boolean;
  callDisabled: boolean;
  /** 不能开始通话的原因(有未发送的本地状态):按钮的 title 与读屏说明 */
  callBlockedReason?: string;
  onCall(): void;
  /** 通话按钮(页面在通话结束、按钮重新可用后把焦点还给它) */
  callButtonRef?: Ref<HTMLButtonElement>;
}) {
  const { t } = useTranslation();
  const rate = usePlaybackRate();
  const [open, setOpen] = useState(false);
  // 复盘/设置:关掉面板并立刻打开抽屉(面板非模态,不锁 body);关闭时焦点不回到调整按钮,交给抽屉
  const sheetOpeningRef = useRef(false);
  const openSheet = (action: () => void) => {
    sheetOpeningRef.current = true;
    setOpen(false);
    action();
  };
  return (
    <div className="flex flex-none items-center">
      {canCall && (
        // callBlockedReason:有未发送的消息时仍可点(点了提示原因),按钮变灰并带说明
        <IconButton tone="blue" className={cn(callBlockedReason && "opacity-50")} data-testid="conversation-call" ref={callButtonRef}
          label={t("web.realtime.start")} disabled={callDisabled} onClick={onCall}
          title={callBlockedReason} aria-describedby={callBlockedReason ? "conversation-call-blocked" : undefined}
          data-blocked={callBlockedReason ? "true" : undefined}>
          <PhoneIcon />
          {callBlockedReason && <span id="conversation-call-blocked" className="sr-only">{callBlockedReason}</span>}
        </IconButton>
      )}
      <PopoverPrimitive.Root open={open} onOpenChange={setOpen}>
        <PopoverPrimitive.Trigger asChild>
          <IconButton data-testid="conversation-options" label={t("web.chat.options.label")} dot={autoSpeak} aria-expanded={open}>
            <SlidersHorizontalIcon />
          </IconButton>
        </PopoverPrimitive.Trigger>
        <PopoverPrimitive.Portal>
          <PopoverPrimitive.Content data-testid="conversation-options-panel" align="end" sideOffset={4} collisionPadding={8}
            aria-label={t("web.chat.options.label")}
            onCloseAutoFocus={(event) => {
              if (!sheetOpeningRef.current) return;
              sheetOpeningRef.current = false;
              event.preventDefault();
            }}
            className={cn(
              "z-40 w-[min(300px,calc(100vw-16px))] rounded-card border-[0.5px] border-hair bg-surface p-1 text-ink",
              "shadow-[0_12px_32px_-12px_rgba(17,19,24,0.3)] focus:outline-none",
              "data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 motion-reduce:animate-none",
            )}>
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
            <div aria-hidden className="mx-3 my-1 h-[0.5px] bg-hair-2" />
            <button type="button" className={rowClass} data-testid="conversation-recap" disabled={!loaded}
              onClick={() => openSheet(onOpenRecap)}>
              <RowText icon={ClipboardListIcon} title={t("web.chat.recap.title")} />
              <ChevronRightIcon aria-hidden className="h-[18px] w-[18px] flex-none text-ink-3" />
            </button>
            <button type="button" className={rowClass} data-testid="conversation-settings" disabled={!loaded}
              onClick={() => openSheet(onOpenSettings)}>
              <RowText icon={Settings2Icon} title={t("web.chat.settings")} />
              <ChevronRightIcon aria-hidden className="h-[18px] w-[18px] flex-none text-ink-3" />
            </button>
          </PopoverPrimitive.Content>
        </PopoverPrimitive.Portal>
      </PopoverPrimitive.Root>
    </div>
  );
}
