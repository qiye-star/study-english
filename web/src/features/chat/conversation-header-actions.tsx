import { ClipboardListIcon, LanguagesIcon, PhoneIcon, Settings2Icon, Volume2Icon, VolumeXIcon } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "@renderer/components/ui/button";
import { cn } from "@renderer/lib/utils";
import { formatPlaybackRate, nextPlaybackRate, setPlaybackRate, usePlaybackRate } from "~/lib/playback-rate";

/** R21:对话页顶栏按钮(双语、自动朗读、语速、设置;Task 4.2 加复盘;Task 4.11 加实时通话,服务端开启且浏览器支持时才显示)。 */
export function ConversationHeaderActions({
  canTranslate, bilingual, autoSpeak, loaded, bilingualSaving, autoSpeakSaving, onToggleBilingual, onToggleAutoSpeak, onOpenSettings, onOpenRecap,
  canCall, callDisabled, onCall,
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
  onCall(): void;
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
        <Button variant="ghost" size="icon" className="h-11 w-11" data-testid="conversation-call"
          aria-label={t("web.realtime.start")} disabled={callDisabled} onClick={onCall}>
          <PhoneIcon className="h-5 w-5" />
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
