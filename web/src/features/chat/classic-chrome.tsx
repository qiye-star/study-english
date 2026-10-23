import { ChevronLeftIcon } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";
import { IconButton } from "~/components/icon-button";
import { ChatPersonaControl } from "~/features/agents";
import { ConversationHeaderActions } from "./conversation-header-actions";
import type { ChromeCtl, ConversationChrome } from "./conversation-chrome";

function ClassicLeading({ ctl }: { ctl: ChromeCtl }) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { conversation } = ctl;
  return (
    <>
      <IconButton label={t("web.common.back")} onClick={() => navigate("/chat")}>
        <ChevronLeftIcon />
      </IconButton>
      {conversation && (
        <ChatPersonaControl personaId={conversation.config.agentPersonaId ?? null} disabled={ctl.busy.any}
          onChange={ctl.choosePersona} onResolved={ctl.reportPersona} onUnavailable={ctl.reportAgentsOff} />
      )}
    </>
  );
}

function ClassicActions({ ctl }: { ctl: ChromeCtl }) {
  const { callState: call, toggles } = ctl;
  return (
    <ConversationHeaderActions canTranslate={toggles.canTranslate} bilingual={toggles.bilingual} autoSpeak={toggles.autoSpeak}
      loaded={toggles.loaded} bilingualSaving={toggles.bilingualSaving} autoSpeakSaving={toggles.autoSpeakSaving}
      onToggleBilingual={ctl.toggleBilingual} onToggleAutoSpeak={ctl.toggleAutoSpeak} onOpenSettings={ctl.openSettings}
      onOpenRecap={ctl.openRecap}
      canCall={call.canCall} callDisabled={call.callDisabled} callBlockedReason={call.callBlockedReason}
      onCall={ctl.startCall} callButtonRef={call.callButtonRef} />
  );
}

/** 旧外框:返回按钮 + 角色芯片 + 通话 / 「调整」面板。`ConversationPage` 不传 `chrome` 时用它。 */
export const CLASSIC_CHROME: ConversationChrome = {
  renderLeading: (ctl) => <ClassicLeading ctl={ctl} />,
  renderActions: (ctl) => <ClassicActions ctl={ctl} />,
};
