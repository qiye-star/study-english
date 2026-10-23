import "./locales";
import { MenuIcon, PhoneIcon, Settings2Icon } from "lucide-react";
import type { TFunction } from "i18next";
import { useTranslation } from "react-i18next";
import { IconButton } from "~/components/icon-button";
import { ChatPersonaControl } from "~/features/agents";
import { cn } from "~/lib/cn";
import { displayName } from "../chat-request";
import type { ChromeCtl, ConversationChrome } from "../conversation-chrome";
import { HISTORY_DRAWER_ID } from "./history-drawer";
import { RoleHint } from "./role-hint";
import { ChatSettingsSheet } from "./chat-settings-sheet";
import { dailyDateText } from "./date-label";
import { EmptyDay } from "./empty-day";

export interface HomeChromeProps {
  t: TFunction;
  lang: string;
  /** 今天的默认对话 id(store 里的 `/today`);用来判断当前对话是不是它 */
  todayId: string | null;
  historyOpen: boolean;
  onOpenHistory(): void;
  historyButtonRef: React.RefObject<HTMLButtonElement | null>;
  settingsOpen: boolean;
  onSettingsOpenChange(open: boolean): void;
  /** 「重播今天的问候」(W10 接线;不传 = 设置面板里没有该入口) */
  onReplay?(): void;
  /** 首次使用提示(FR8);对话主页上的对话从不显示 */
  hint?: { show: boolean; dismiss(): void };
  /** 追加的消息包装(问候组,W9) */
  renderMessage?: ConversationChrome["renderMessage"];
  beforeMessages?: ConversationChrome["beforeMessages"];
}

function HomeLeading({ ctl, p }: { ctl: ChromeCtl; p: HomeChromeProps }) {
  const { t } = useTranslation();
  const { conversation } = ctl;
  return (
    <>
      <IconButton ref={p.historyButtonRef} data-testid="chat-history-open" label={t("web.chat.home.bar.historyOpen")}
        aria-haspopup="dialog" aria-controls={HISTORY_DRAWER_ID} aria-expanded={p.historyOpen} onClick={p.onOpenHistory}>
        <MenuIcon />
      </IconButton>
      {conversation && (
        // 角色在设置面板里选;这里只解析角色名(助手头像、副标题)与「智能体已关闭」
        <ChatPersonaControl headless personaId={conversation.config.agentPersonaId ?? null} disabled={ctl.busy.any}
          onChange={ctl.choosePersona} onResolved={ctl.reportPersona} onUnavailable={ctl.reportAgentsOff} />
      )}
    </>
  );
}

/** 设置按钮 + 它打开的设置面板;`pulse` = 首次使用提示的脉冲环(减弱动效时无动画)。 */
export function SettingsButton({ onClick, expanded, pulse, hint }: {
  onClick(): void; expanded: boolean; pulse?: boolean; hint?: { show: boolean; dismiss(): void };
}) {
  const { t } = useTranslation();
  return (
    <span className="relative inline-flex">
      <IconButton data-testid="chat-settings-open" label={t("web.chat.home.bar.settingsOpen")} aria-haspopup="dialog" aria-expanded={expanded}
        className={cn(pulse && "ring-2 ring-blue/50 motion-safe:animate-pulse")} onClick={onClick}>
        <Settings2Icon />
      </IconButton>
      {hint?.show ? <RoleHint onDismiss={hint.dismiss} /> : null}
    </span>
  );
}

function HomeActions({ ctl, p }: { ctl: ChromeCtl; p: HomeChromeProps }) {
  const { t } = useTranslation();
  const { callState: call } = ctl;
  return (
    <div className="flex flex-none items-center">
      {call.canCall && (
        // 同旧顶栏:有未发送的本地状态时仍可点(点了提示原因),按钮变灰并带说明
        <IconButton tone="blue" className={cn(call.callBlockedReason && "opacity-50")} data-testid="conversation-call" ref={call.callButtonRef}
          label={t("web.realtime.start")} disabled={call.callDisabled} onClick={ctl.startCall}
          title={call.callBlockedReason} aria-describedby={call.callBlockedReason ? "conversation-call-blocked" : undefined}
          data-blocked={call.callBlockedReason ? "true" : undefined}>
          <PhoneIcon />
          {call.callBlockedReason && <span id="conversation-call-blocked" className="sr-only">{call.callBlockedReason}</span>}
        </IconButton>
      )}
      <SettingsButton expanded={p.settingsOpen} onClick={() => { p.hint?.dismiss(); p.onSettingsOpenChange(true); }} />
      <ChatSettingsSheet open={p.settingsOpen} onOpenChange={p.onSettingsOpenChange} ctl={ctl} onReplay={p.onReplay} />
    </div>
  );
}

const weekdayOf = (lang: string) => new Intl.DateTimeFormat(lang, { weekday: "short" }).format(new Date());

/** 对话主页的外框(FR4):左 = 历史按钮;中 = 标题(今天 =「今天 · 周五」)+ 副标题(角色名 · 每日对话);右 = 通话 + 设置。 */
export function homeChrome(p: HomeChromeProps): ConversationChrome {
  return {
    renderLeading: (ctl) => <HomeLeading ctl={ctl} p={p} />,
    renderActions: (ctl) => <HomeActions ctl={ctl} p={p} />,
    renderTitle: (ctl) => {
      const c = ctl.conversation;
      if (!c) return { title: p.t("web.common.loading") };
      const today = c.id === p.todayId;
      const title = today
        ? p.t("web.chat.home.bar.today", { weekday: weekdayOf(p.lang) })
        : c.dailyDate ? `${p.t("web.chat.home.drawer.dailyChat")} · ${dailyDateText(c.dailyDate, p.lang)}` : displayName(c, p.t("web.chat.untitled"));
      const kind = today ? p.t("web.chat.home.bar.dailyKind") : null; // 其他每日对话的标题里已有「每日对话」
      const name = ctl.personaName;
      const subtitle = name && kind ? p.t("web.chat.home.bar.persona", { name, kind }) : name ?? kind ?? undefined;
      return { title, subtitle };
    },
    beforeMessages: p.beforeMessages,
    renderMessage: p.renderMessage,
    emptyState: () => <EmptyDay />,
  };
}
