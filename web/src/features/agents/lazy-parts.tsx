import { lazy, Suspense, type ComponentType, type ReactNode } from "react";

/**
 * 懒加载包装(R-W2):主包里只有这个函数与每个组件一行包装;实现、文案在各自的块里。
 * fallback 默认为空(页面里的局部块);页面级组件传一个占位。
 */
export function part<P extends object>(load: () => Promise<ComponentType<P>>, fallback: ReactNode = null): ComponentType<P> {
  const Lazy = lazy(async () => ({ default: await load() })) as unknown as ComponentType<Record<string, unknown>>;
  function Part(props: P) {
    return (
      <Suspense fallback={fallback}>
        <Lazy {...(props as Record<string, unknown>)} />
      </Suspense>
    );
  }
  return Part;
}

export const pageFallback = <div aria-busy="true" className="min-h-40" />;
/** 「中文」折叠的占位:与按钮同高(44 px),文案块到达时不跳动 */
const noteFallback = <span aria-hidden className="mt-1 block h-tap" />;

// ---- parts ----
export const ProcessCapsule = /* @__PURE__ */ part<import("./process-capsule").ProcessCapsuleProps>(() => import("./process-capsule").then((m) => m.ProcessCapsule));
export const SourceChips = /* @__PURE__ */ part<import("./source-chips").SourceChipsProps>(() => import("./source-chips").then((m) => m.SourceChips));
export const PersonaChip = /* @__PURE__ */ part<import("./persona-chip").PersonaChipProps>(() => import("./persona-chip").then((m) => m.PersonaChip));
export const PersonaEditorSheet = /* @__PURE__ */ part<import("./persona-editor-sheet").PersonaEditorSheetProps>(() => import("./persona-editor-sheet").then((m) => m.PersonaEditorSheet));
export const PersonaPicker = /* @__PURE__ */ part<import("./persona-picker").PersonaPickerProps>(() => import("./persona-picker").then((m) => m.PersonaPicker));
export const ReportPersonaSheet = /* @__PURE__ */ part<import("./report-persona-sheet").ReportPersonaSheetProps>(() => import("./report-persona-sheet").then((m) => m.ReportPersonaSheet));
export const AgentSettingsPage = /* @__PURE__ */ part<object>(() => import("./agent-settings-page").then((m) => m.AgentSettingsPage), pageFallback);
export const AgentsMeRow = /* @__PURE__ */ part<object>(() => import("./me-row").then((m) => m.AgentsMeRow));
export const ChatPersonaControl = /* @__PURE__ */ part<import("./chat-parts").ChatPersonaControlProps>(() => import("./chat-parts").then((m) => m.ChatPersonaControl));
export const TutorEntry = /* @__PURE__ */ part<import("./chat-parts").TutorEntryProps>(() => import("./chat-parts").then((m) => m.TutorEntry));
export const TutorBarSlot = /* @__PURE__ */ part<import("./chat-parts").TutorBarSlotProps>(() => import("./chat-parts").then((m) => m.TutorBarSlot));
export const AgentNote = /* @__PURE__ */ part<import("./agent-note").AgentNoteProps>(() => import("./agent-note").then((m) => m.AgentNote), noteFallback);
