import "./locales";
import { GraduationCapIcon } from "lucide-react";
import { Suspense, lazy, useEffect, useState, type ComponentType } from "react";
import { useTranslation } from "react-i18next";
import { PersonaChip } from "./persona-chip";
import { PersonaPicker } from "./persona-picker";
import type { Persona, TurnMeta } from "./types";
import { useAgentsConfig, usePersonas } from "./use-agents-data";

export interface ChatPersonaControlProps {
  personaId: string | null;
  disabled: boolean;
  /** 选了不同的角色(null = 不使用角色) */
  onChange(persona: Persona | null): void;
  /** 解析出的当前角色(助手头像用) */
  onResolved?(persona: Persona | null): void;
  /** 会话记着角色、但智能体在服务端已关闭(config 说关闭):对话页据此给出「切回普通对话」 */
  onUnavailable?(unavailable: boolean): void;
}

/** 对话顶栏的角色控件(懒加载块):智能体关闭时什么都不渲染,旧会话因此完全不变。 */
export function ChatPersonaControl({ personaId, disabled, onChange, onResolved, onUnavailable }: ChatPersonaControlProps) {
  const { config } = useAgentsConfig();
  const enabled = !!config?.enabled;
  // 没有角色的旧会话不取角色列表(选择器打开时自己取):旧会话最多一次 /api/agents/ 请求
  const { personas } = usePersonas(enabled && !!personaId);
  const [open, setOpen] = useState(false);
  const persona = personaId ? personas?.find((p) => p.id === personaId) ?? null : null;
  useEffect(() => {
    onResolved?.(persona);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [persona?.id, persona?.name]);
  const unavailable = !!config && !config.enabled && !!personaId;
  useEffect(() => {
    onUnavailable?.(unavailable);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [unavailable]);
  if (!enabled) return null;
  return (
    <>
      <PersonaChip persona={persona} pendingId={personaId} disabled={disabled} onClick={() => setOpen(true)} />
      <PersonaPicker open={open} onOpenChange={setOpen} selectedId={personaId} allowNone
        onSelect={(p) => {
          setOpen(false);
          if ((p?.id ?? null) !== personaId) onChange(p);
        }} />
    </>
  );
}

// ---- 「带我学」插槽(R-W18、INDEX X7) ----
// 导师组件属于 A3-W(agents/tutor/*),这里只经 import() 懒加载填槽(各一行);槽为空时入口与导师条都不渲染。测试可直接给槽赋值。
// A3-W 对 A4 原契约的追加(Ruling R-T19):onStarted 多一个参数(回答方式、是否让智能体先开口);
// Bar 多 lastReply / onSpeak / onTranslateLast(「听一遍」「翻译」要用对话页的朗读和翻译)。

export interface TutorStartInfo {
  /** 开始面板选的回答方式(续上的会话取原来的):语音 → 对话页把输入栏切到「按住说话」 */
  input: "text" | "voice";
  /** 智能体要先开口:对话页随即发一个 text = null 的回合;续上等待回答的会话为 false */
  speakFirst: boolean;
}
export interface TutorStartSheetProps {
  open: boolean;
  onOpenChange(open: boolean): void;
  personaId: string;
  conversationId: string;
  /** 开始成功:交出导师会话 id,对话页进入导师模式(并按 info 让智能体先开口) */
  onStarted(sessionId: string, info: TutorStartInfo): void;
}
export interface TutorBarSlotProps {
  sessionId: string;
  /** 最近一次回合的 meta 事件(第几题 / 评价);开场之前为 null */
  meta: TurnMeta | null;
  busy: boolean;
  /** 再跑一个 text = null 的回合 */
  onContinue(): void;
  /** 带学结束(总结抽屉关闭后 / 过期):对话页退出导师模式 */
  onEnd(): void;
  /** 最后一条完成的助手消息(「听一遍」) */
  lastReply: string;
  onSpeak(text: string): void;
  onTranslateLast(): void;
}
export const TUTOR_SLOTS: {
  StartSheet: ComponentType<TutorStartSheetProps> | null;
  Bar: ComponentType<TutorBarSlotProps> | null;
} = {
  StartSheet: lazy(() => import("./tutor/tutor-start-sheet").then((m) => ({ default: m.TutorStartSheet }))),
  Bar: lazy(() => import("./tutor/tutor-bar-panel").then((m) => ({ default: m.TutorBarPanel }))),
};

export interface TutorEntryProps {
  personaId: string | null;
  conversationId: string;
  disabled: boolean;
  onStarted(sessionId: string, info: TutorStartInfo): void;
}

/** 输入条提示行右侧的「带我学」入口(R-W18):有角色、导师开启且槽已填时才出现。 */
export function TutorEntry({ personaId, conversationId, disabled, onStarted }: TutorEntryProps) {
  const { t } = useTranslation();
  const { config } = useAgentsConfig();
  const [open, setOpen] = useState(false);
  const StartSheet = TUTOR_SLOTS.StartSheet;
  if (!StartSheet || !config?.enabled || !config.tutorEnabled || !personaId) return null;
  return (
    <>
      <button type="button" data-testid="agent-tutor-entry" disabled={disabled} onClick={() => setOpen(true)}
        className="hit-expand ml-2 inline-flex h-8 flex-none items-center gap-1 whitespace-nowrap rounded-full bg-blue-tint px-2.5 text-sub font-semibold text-blue plate liquid:text-ink disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
        <GraduationCapIcon aria-hidden className="h-4 w-4" />{t("web.agents.tutor.entry")}
      </button>
      {open && (
        <Suspense fallback={null}>
          <StartSheet open onOpenChange={setOpen} personaId={personaId} conversationId={conversationId}
            onStarted={(sessionId, info) => { setOpen(false); onStarted(sessionId, info); }} />
        </Suspense>
      )}
    </>
  );
}

/** 导师条的槽(R-W18):对话页把导师状态交给 A3 的 TutorBar;槽为空时不渲染。 */
export function TutorBarSlot(props: TutorBarSlotProps) {
  const Bar = TUTOR_SLOTS.Bar;
  return Bar ? <Suspense fallback={null}><Bar {...props} /></Suspense> : null;
}
