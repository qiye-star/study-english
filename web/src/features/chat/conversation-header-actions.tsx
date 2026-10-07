import { ClipboardListIcon, LanguagesIcon, PhoneIcon, Settings2Icon, Volume2Icon, VolumeXIcon } from "lucide-react";
import type { Ref } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@renderer/components/ui/button";
import { cn } from "@renderer/lib/utils";
import { formatPlaybackRate, nextPlaybackRate, setPlaybackRate, usePlaybackRate } from "~/lib/playback-rate";

/** R21:对话页顶栏按钮(双语、自动朗读、语速、设置;Task 4.2 加复盘;Task 4.11 加实时通话,服务端开启且浏览器支持时才显示)。 */
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
  return (
    <div className="flex">
      {canTranslate && (
        <Button variant="ghost" size="icon" className="h-11 w-11" data-testid="conversation-bilingual"
          aria-pressed={bilingual} aria-label={t("web.chat.bilingual")} disabled={!loaded || bilingualSaving}
          onClick={onToggleBilingual}>
          <LanguagesIcon className={cn("h-5 w-5", bilingual ? "text-primary" : "text-muted-foreground")} />
        </Button>
      )}
      <Button variant="ghost" size="icon" className="h-11 w-11" data-testid="conversation-autospeak"
        aria-pressed={autoSpeak} aria-label={t("web.chat.autoSpeak.toggle")} disabled={!loaded || autoSpeakSaving}
        onClick={onToggleAutoSpeak}>
        {autoSpeak ? <Volume2Icon className="h-5 w-5 text-primary" /> : <VolumeXIcon className="h-5 w-5 text-muted-foreground" />}
      </Button>
      <Button variant="ghost" className="h-11 min-w-11 px-1 text-sm tabular-nums" data-testid="conversation-speed"
        aria-label={t("web.chat.speed.label", { rate: formatPlaybackRate(rate) })} onClick={() => setPlaybackRate(nextPlaybackRate(rate))}>
        {formatPlaybackRate(rate)}
      </Button>
      {canCall && (
        // callBlockedReason:有未发送的消息时仍可点(点了提示原因),按钮变灰并带说明
        <Button variant="ghost" size="icon" className={cn("h-11 w-11", callBlockedReason && "opacity-50")} data-testid="conversation-call" ref={callButtonRef}
          aria-label={t("web.realtime.start")} disabled={callDisabled} onClick={onCall}
          title={callBlockedReason} aria-describedby={callBlockedReason ? "conversation-call-blocked" : undefined}
          data-blocked={callBlockedReason ? "true" : undefined}>
          <PhoneIcon className="h-5 w-5" />
          {callBlockedReason && <span id="conversation-call-blocked" className="sr-only">{callBlockedReason}</span>}
        </Button>
      )}
      <Button variant="ghost" size="icon" className="h-11 w-11" data-testid="conversation-recap"
        aria-label={t("web.chat.recap.title")} disabled={!loaded} onClick={onOpenRecap}>
        <ClipboardListIcon className="h-5 w-5" />
      </Button>
      <Button variant="ghost" size="icon" className="h-11 w-11" data-testid="conversation-settings"
        aria-label={t("web.chat.settings")} disabled={!loaded} onClick={onOpenSettings}>
        <Settings2Icon className="h-5 w-5" />
      </Button>
    </div>
  );
}
