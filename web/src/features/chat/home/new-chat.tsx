import "./locales";
import { MenuIcon, MessagesSquareIcon } from "lucide-react";
import { useEffect, useRef, useState, type RefObject } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";
import { loadServerAiConfig } from "~/api/server-config";
import { translateServerError } from "~/api/error-messages";
import { useAuth } from "~/auth/auth-context";
import { GlassTopBar } from "~/components/glass-top-bar";
import { IconButton } from "~/components/icon-button";
import { IconChip } from "~/components/icon-chip";
import { PersonaPicker, agentsApi, type Persona } from "~/features/agents";
import { cn } from "~/lib/cn";
import { CHAT_SERVER_ERRORS, DEFAULT_CONVERSATION_NAME, createConversation } from "../chat-api";
import { ScenarioSheet } from "../scenario-sheet";
import { HISTORY_DRAWER_ID } from "./history-drawer";
import { SettingsButton } from "./home-chrome";
import { useRoleHint } from "./role-hint";

const BTN = "inline-flex h-11 min-w-[160px] items-center justify-center rounded-button px-5 text-sub font-semibold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50 liquid:rounded-full";

/**
 * 新对话草稿(FR6):只在本地,不建服务端对话,所以随手点开不会留下空对话、不占上限。
 * 选了角色 / 直接开始 / 从场景开始 才真正创建,然后 `replace` 到 `/chat/:id`。
 */
export function NewChat({ historyOpen, onOpenHistory, historyButtonRef }: {
  historyOpen: boolean;
  onOpenHistory(): void;
  historyButtonRef: RefObject<HTMLButtonElement | null>;
}) {
  const { t } = useTranslation();
  const { api } = useAuth();
  const navigate = useNavigate();
  const hint = useRoleHint();
  const [agentsOn, setAgentsOn] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [scenarioOpen, setScenarioOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const busyRef = useRef(false);
  const aliveRef = useRef(true);
  useEffect(() => {
    aliveRef.current = true;
    let alive = true;
    agentsApi.config(api).then((c) => { if (alive) setAgentsOn(c.enabled); }, (): void => undefined);
    return () => { alive = false; aliveRef.current = false; };
  }, [api]);

  const create = async (persona: Persona | null) => {
    if (busyRef.current) return; // 同步防连点
    busyRef.current = true;
    setBusy(true);
    setError(null);
    try {
      let config: Parameters<typeof createConversation>[1]["config"];
      if (persona) {
        // 角色音色(同对话页 choosePersona):取服务端默认朗读模型;取不到就只写角色
        const ai = persona.voice ? await loadServerAiConfig(api).catch((): null => null) : null;
        config = { agentPersonaId: persona.id, ...(ai && persona.voice ? { ttsModel: ai.defaultTts.model, ttsVoice: persona.voice } : {}) };
      } else {
        config = { scenario: { id: "free" }, level: "auto" }; // 没有角色时与旧列表的「自由对话」完全一致
      }
      const conversation = await createConversation(api, { name: DEFAULT_CONVERSATION_NAME, config });
      navigate(`/chat/${conversation.id}`, { replace: true }); // 成功后保持忙碌:路由随即换掉本页,不再接受第二次点击
    } catch (err) {
      busyRef.current = false;
      if (aliveRef.current) {
        setBusy(false);
        setError(translateServerError(t, err, CHAT_SERVER_ERRORS));
      }
    }
  };

  const openPicker = () => { hint.dismiss(); setPickerOpen(true); };

  return (
    <div className="relative flex min-h-0 flex-1 flex-col" data-testid="chat-new">
      <GlassTopBar className="absolute inset-x-0 top-0" scrolled={false} title={t("web.chat.home.newChat.title")}
        leading={
          <IconButton ref={historyButtonRef} data-testid="chat-history-open" label={t("web.chat.home.bar.historyOpen")}
            aria-haspopup="dialog" aria-controls={HISTORY_DRAWER_ID} aria-expanded={historyOpen} onClick={onOpenHistory}>
            <MenuIcon />
          </IconButton>
        }
        actions={agentsOn ? <SettingsButton expanded={pickerOpen} pulse={hint.show} hint={hint} onClick={openPicker} /> : undefined} />
      <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-3 px-gutter pb-16 pt-[calc(52px+env(safe-area-inset-top))] text-center">
        <IconChip tone="blue" icon={MessagesSquareIcon} />
        <p data-testid="chat-new-hint" className="max-w-[28ch] text-sub text-ink-2">{t("web.chat.home.newChat.hint")}</p>
        {error && <p role="alert" className="text-sub text-red">{error}</p>}
        <div className="flex flex-col items-center gap-2">
          {agentsOn && (
            <button type="button" data-testid="chat-new-pick-role" disabled={busy} onClick={openPicker} className={cn(BTN, "bg-blue text-on-blue")}>
              {t("web.chat.home.newChat.pickRole")}
            </button>
          )}
          <button type="button" data-testid="chat-new-just-start" disabled={busy} onClick={() => void create(null)}
            className={cn(BTN, agentsOn ? "text-blue" : "bg-blue text-on-blue")}>
            {t("web.chat.home.newChat.justStart")}
          </button>
          <button type="button" data-testid="chat-new-scenario" disabled={busy} onClick={() => setScenarioOpen(true)} className={cn(BTN, "text-blue")}>
            {t("web.chat.home.newChat.fromScenario")}
          </button>
        </div>
      </div>
      <PersonaPicker open={pickerOpen} onOpenChange={setPickerOpen} selectedId={null} allowNone
        onSelect={(p) => { setPickerOpen(false); void create(p); }} />
      <ScenarioSheet open={scenarioOpen} onOpenChange={setScenarioOpen}
        onCreated={(id, openingId) => {
          setScenarioOpen(false);
          navigate(`/chat/${id}`, { replace: true, ...(openingId ? { state: { speakOpening: openingId } } : {}) });
        }} />
    </div>
  );
}
