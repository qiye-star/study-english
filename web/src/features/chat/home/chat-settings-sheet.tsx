import "./locales";
import { ChevronRightIcon, ClipboardListIcon, PlayIcon, Settings2Icon, SparklesIcon } from "lucide-react";
import { useEffect, useState, type ComponentType, type ReactNode, type SVGProps } from "react";
import { useTranslation } from "react-i18next";
import { BottomSheet, BottomSheetContent, BottomSheetHeader } from "~/components/bottom-sheet";
import { PersonaPicker, PersonaRadioList } from "~/features/agents";
import { cn } from "~/lib/cn";
import type { ChromeCtl } from "../conversation-chrome";
import { OptionRows, RowText, SwitchVisual, rowClass } from "../options-rows";
import type { ChatPrefs, GreetingLanguage, GreetingTrigger } from "./chat-home-api";
import { clearGreetingFacts, useChatHomeState } from "./chat-home-store";
import { SettingSegment } from "./segmented";
import { useChatPrefs } from "./use-chat-prefs";

type Icon = ComponentType<SVGProps<SVGSVGElement>>;

/** 问候语言 → 今天对话的回复提示(R7):zh / bilingual = 中文提示(bilingual 另开自动翻译);en = 不提示。undefined = 清除该键。 */
export function conversationHintFor(language: GreetingLanguage): { zhNote: "always" | undefined; bilingual: boolean } {
  return { zhNote: language === "en" ? undefined : "always", bilingual: language === "bilingual" };
}

const DEFAULT_DAILY_PERSONA = "builtin:partner";

function SwitchRow({ testId, icon, title, hint, on, disabled, onToggle }: {
  testId: string; icon: Icon; title: ReactNode; hint?: ReactNode; on: boolean; disabled?: boolean; onToggle(): void;
}) {
  return (
    <button type="button" role="switch" aria-checked={on} data-testid={testId} disabled={disabled} onClick={onToggle} className={rowClass}>
      <RowText icon={icon} title={title} subtitle={hint} />
      <SwitchVisual on={on} />
    </button>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="mt-3 first:mt-0" aria-label={title}>
      <h3 className="px-3 pb-0.5 text-meta font-medium text-ink-2">{title}</h3>
      {children}
    </section>
  );
}

/**
 * 对话主页的设置面板(FR5):本对话角色 → 问候语言 / 时机 / 学习数据(全局)→ 本对话三行选项 → 复盘 / 更多设置 / 重播。
 * 本对话的写入走 `ctl.saveSettings`(现有 config 写入链,不会互相覆盖);全局项走 PATCH /api/chat-home/settings。
 * 角色单选的「更多」会先关掉本面板再打开 PersonaPicker(两个底部抽屉不嵌套)。
 */
export function ChatSettingsSheet({ open, onOpenChange, ctl, onReplay }: {
  open: boolean;
  onOpenChange(open: boolean): void;
  ctl: ChromeCtl;
  /** 「重播今天的问候」:调用方在面板关闭后打开弹窗(mode="replay";W10 接线) */
  onReplay?(): void;
}) {
  const { t } = useTranslation();
  const { prefs, status, retry, save } = useChatPrefs(open);
  const { today } = useChatHomeState();
  const [pickerOpen, setPickerOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // 乐观值:PATCH 期间先显示新选项,失败回滚
  const [optimistic, setOptimistic] = useState<Partial<ChatPrefs>>({});
  useEffect(() => { if (open) setError(null); }, [open]);

  const conversation = ctl.conversation;
  const isToday = !!conversation && today?.conversation.id === conversation.id;
  const replayable = isToday && today?.status === "ready" && today.greeting?.lines.length === 3;
  const personaId = conversation?.config.agentPersonaId ?? null;
  const view: Partial<ChatPrefs> = { ...prefs, ...optimistic };

  const update = async (partial: Partial<ChatPrefs>, after?: (saved: ChatPrefs) => void) => {
    setError(null);
    setOptimistic((o) => ({ ...o, ...partial }));
    try {
      const saved = await save(partial);
      after?.(saved);
    } catch {
      setError(t("web.chat.home.settings.saveFailed"));
    } finally {
      setOptimistic((o) => {
        const next = { ...o };
        for (const key of Object.keys(partial) as Array<keyof ChatPrefs>) delete next[key];
        return next;
      });
    }
  };

  const setLanguage = (language: GreetingLanguage) => {
    void update({ language }, () => {
      // 今天的默认对话:回复提示立即生效(今天已存的问候不重写,R7)
      if (isToday) void ctl.saveSettings(conversationHintFor(language)).catch((): void => undefined);
    });
  };

  const closeThen = (action: () => void) => {
    onOpenChange(false);
    action();
  };

  const globalDisabled = status === "loading" || !prefs;
  const langOptions = [
    { value: "zh", label: t("web.chat.home.settings.language.zh"), testId: "chat-greeting-lang-zh" },
    { value: "en", label: t("web.chat.home.settings.language.en"), testId: "chat-greeting-lang-en" },
    { value: "bilingual", label: t("web.chat.home.settings.language.bilingual"), testId: "chat-greeting-lang-bilingual" },
  ] as const;
  const triggerOptions = [
    { value: "daily", label: t("web.chat.home.settings.triggerDaily"), testId: "chat-greeting-trigger-daily" },
    { value: "every_open", label: t("web.chat.home.settings.triggerEveryOpen"), testId: "chat-greeting-trigger-every_open" },
    { value: "off", label: t("web.chat.home.settings.triggerOff"), testId: "chat-greeting-trigger-off" },
  ] as const;

  return (
    <>
      <BottomSheet open={open} onOpenChange={onOpenChange}>
        <BottomSheetContent data-testid="chat-settings-sheet" className="max-h-[88dvh] overflow-y-auto">
          <BottomSheetHeader title={t("web.chat.home.settings.title")} description={t("web.chat.home.settings.description")} srOnlyDescription />
          {error && <p role="alert" className="mb-2 rounded-[10px] bg-surface-2 px-3 py-2 text-sub text-red">{error}</p>}

          {conversation && (
            <div className="mb-3 px-3">
              <PersonaRadioList selectedId={personaId} disabled={ctl.busy.any} heading={t("web.chat.home.settings.role")}
                onSelect={(p) => ctl.choosePersona(p)}
                onMore={() => closeThen(() => setPickerOpen(true))}
                footer={isToday && personaId ? (
                  <SwitchRow testId="chat-daily-persona" icon={SparklesIcon} title={t("web.chat.home.settings.dailyPersona")}
                    on={view.dailyPersonaId === personaId} disabled={globalDisabled || ctl.busy.any}
                    onToggle={() => void update({ dailyPersonaId: view.dailyPersonaId === personaId ? DEFAULT_DAILY_PERSONA : personaId })} />
                ) : null} />
            </div>
          )}

          <Section title={t("web.chat.home.settings.global")}>
            {status === "error" && !prefs && (
              <p role="alert" className="flex items-center gap-2 px-3 py-1 text-sub text-ink-2">
                {t("web.chat.home.settings.loadFailed")}
                <button type="button" onClick={() => void retry()} className="min-h-tap font-semibold text-blue">{t("web.common.retry")}</button>
              </p>
            )}
            <div className="px-3">
              <SettingSegment<GreetingLanguage> title={t("web.chat.home.settings.language.title")} value={view.language ?? "bilingual"} options={langOptions}
                disabled={globalDisabled} onChange={setLanguage} hint={t("web.chat.home.settings.languageHint")} />
              <SettingSegment<GreetingTrigger> title={t("web.chat.home.settings.trigger")} value={view.greetingTrigger ?? "daily"} options={triggerOptions}
                disabled={globalDisabled} onChange={(greetingTrigger) => void update({ greetingTrigger })}
                hint={t(`web.chat.home.settings.triggerHint.${view.greetingTrigger ?? "daily"}`)} />
            </div>
            <SwitchRow testId="chat-greeting-stats" icon={ClipboardListIcon} title={t("web.chat.home.settings.stats")} hint={t("web.chat.home.settings.statsHint")}
              on={view.includeStats ?? true} disabled={globalDisabled}
              onToggle={() => {
                const next = !(view.includeStats ?? true);
                void update({ includeStats: next }, () => { if (!next) clearGreetingFacts(); });
              }} />
          </Section>

          <Section title={t("web.chat.home.settings.thisChat")}>
            <OptionRows toggles={ctl.toggles} onToggleBilingual={ctl.toggleBilingual} onToggleAutoSpeak={ctl.toggleAutoSpeak} />
            <button type="button" className={rowClass} data-testid="conversation-recap" disabled={!ctl.toggles.loaded}
              onClick={() => closeThen(ctl.openRecap)}>
              <RowText icon={ClipboardListIcon} title={t("web.chat.recap.title")} />
              <ChevronRightIcon aria-hidden className="h-[18px] w-[18px] flex-none text-ink-3" />
            </button>
            <button type="button" className={rowClass} data-testid="conversation-settings" disabled={!ctl.toggles.loaded}
              onClick={() => closeThen(ctl.openSettings)}>
              <RowText icon={Settings2Icon} title={t("web.chat.settings")} />
              <ChevronRightIcon aria-hidden className="h-[18px] w-[18px] flex-none text-ink-3" />
            </button>
            {replayable && onReplay && (
              <button type="button" className={rowClass} data-testid="chat-greeting-replay" onClick={() => closeThen(onReplay)}>
                <RowText icon={PlayIcon} title={t("web.chat.home.settings.replay")} subtitle={t("web.chat.home.settings.replayHint")} />
              </button>
            )}
          </Section>

          <button type="button" data-testid="chat-settings-done" onClick={() => onOpenChange(false)}
            className={cn("mt-3 flex h-11 w-full items-center justify-center rounded-button bg-surface-2 text-sub font-semibold text-ink liquid:rounded-full",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring")}>
            {t("web.chat.home.settings.done")}
          </button>
        </BottomSheetContent>
      </BottomSheet>
      <PersonaPicker open={pickerOpen} onOpenChange={setPickerOpen} selectedId={personaId} allowNone
        onSelect={(p) => {
          setPickerOpen(false);
          if ((p?.id ?? null) !== personaId) ctl.choosePersona(p);
        }} />
    </>
  );
}
