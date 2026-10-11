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

// ---- parts ----
export const ProcessCapsule = part<import("./process-capsule").ProcessCapsuleProps>(() => import("./process-capsule").then((m) => m.ProcessCapsule));
export const SourceChips = part<import("./source-chips").SourceChipsProps>(() => import("./source-chips").then((m) => m.SourceChips));
export const PersonaChip = part<import("./persona-chip").PersonaChipProps>(() => import("./persona-chip").then((m) => m.PersonaChip));
export const PersonaEditorSheet = part<import("./persona-editor-sheet").PersonaEditorSheetProps>(() => import("./persona-editor-sheet").then((m) => m.PersonaEditorSheet));
export const PersonaPicker = part<import("./persona-picker").PersonaPickerProps>(() => import("./persona-picker").then((m) => m.PersonaPicker));
export const ReportPersonaSheet = part<import("./report-persona-sheet").ReportPersonaSheetProps>(() => import("./report-persona-sheet").then((m) => m.ReportPersonaSheet));
