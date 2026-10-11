import "./locales";
import { GraduationCapIcon } from "lucide-react";
import { Suspense, useEffect, useState, type ComponentType } from "react";
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
}

/** 对话顶栏的角色控件(懒加载块):智能体关闭时什么都不渲染,旧会话因此完全不变。 */
export function ChatPersonaControl({ personaId, disabled, onChange, onResolved }: ChatPersonaControlProps) {
  const { config } = useAgentsConfig();
  const enabled = !!config?.enabled;
  const { personas } = usePersonas(enabled);
  const [open, setOpen] = useState(false);
  const persona = personaId ? personas?.find((p) => p.id === personaId) ?? null : null;
  useEffect(() => {
    onResolved?.(persona);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [persona?.id, persona?.name]);
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
// 导师组件属于 A3-W(agents/tutor/*),A4 不导入它们。A3-W 只需要把下面两个槽填上(各一行,懒加载):
//   TUTOR_SLOTS.StartSheet = lazy(() => import("./tutor/tutor-start-sheet").then((m) => ({ default: m.TutorStartSheet })));
//   TUTOR_SLOTS.Bar = lazy(() => import("./tutor/tutor-bar").then((m) => ({ default: m.TutorBar })));
// 槽为空时入口与导师条都不渲染(不会出现点了没反应的按钮)。测试可直接给槽赋值。

export interface TutorStartSheetProps {
  open: boolean;
  onOpenChange(open: boolean): void;
  personaId: string;
  conversationId: string;
  /** 开始成功:交出导师会话 id,对话页进入导师模式并让智能体先开口 */
  onStarted(sessionId: string): void;
}
export interface TutorBarSlotProps {
  sessionId: string;
  /** 最近一次回合的 meta 事件(第几题 / 评价);开场之前为 null */
  meta: TurnMeta | null;
  busy: boolean;
  /** 再跑一个 text = null 的回合 */
  onContinue(): void;
  onEnd(): void;
}
export const TUTOR_SLOTS: {
  StartSheet: ComponentType<TutorStartSheetProps> | null;
  Bar: ComponentType<TutorBarSlotProps> | null;
} = { StartSheet: null, Bar: null };

export interface TutorEntryProps {
  personaId: string | null;
  conversationId: string;
  disabled: boolean;
  onStarted(sessionId: string): void;
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
        className="hit-expand ml-2 inline-flex h-8 flex-none items-center gap-1 whitespace-nowrap rounded-full bg-blue-tint px-2.5 text-sub font-semibold text-blue disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
        <GraduationCapIcon aria-hidden className="h-4 w-4" />{t("web.agents.tutor.entry")}
      </button>
      {open && (
        <Suspense fallback={null}>
          <StartSheet open onOpenChange={setOpen} personaId={personaId} conversationId={conversationId}
            onStarted={(sessionId) => { setOpen(false); onStarted(sessionId); }} />
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
