import * as PopoverPrimitive from "@radix-ui/react-popover";
import { ChevronRightIcon, ClipboardListIcon, PhoneIcon, Settings2Icon, SlidersHorizontalIcon } from "lucide-react";
import { useRef, useState, type Ref } from "react";
import { useTranslation } from "react-i18next";
import { cn } from "~/lib/cn";
import { IconButton } from "~/components/icon-button";
import { OptionRows, RowText, rowClass } from "./options-rows";

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
              "z-40 w-[min(300px,calc(100vw-16px))] rounded-card border-[0.5px] border-hair bg-surface p-1 text-ink mat-sheet liquid:rounded-tile liquid:p-1",
              "shadow-[0_12px_32px_-12px_rgba(17,19,24,0.3)] focus:outline-none",
              "data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 motion-reduce:animate-none",
            )}>
            <OptionRows toggles={{ canTranslate, bilingual, autoSpeak, loaded, bilingualSaving, autoSpeakSaving }}
              onToggleBilingual={onToggleBilingual} onToggleAutoSpeak={onToggleAutoSpeak} />
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
