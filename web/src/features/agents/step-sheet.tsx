import { RefreshCwIcon, ShieldCheckIcon } from "lucide-react";
import { LQ_NOTE, LQ_PRIMARY, LQ_SECONDARY } from "~/components/liquid";
import { useTranslation } from "react-i18next";
import { BottomSheet, BottomSheetContent, BottomSheetHeader } from "~/components/bottom-sheet";
import { formatParams, stepLabel } from "./step-labels";
import type { AgentStep } from "./types";

/** 工具详情(视觉稿 3 屏):工具、参数(只有词本身)、状态、耗时;关闭 / 重新生成。 */
export function StepSheet({ step, onClose, onRegenerate }: { step: AgentStep | null; onClose(): void; onRegenerate?: () => void }) {
  const { t } = useTranslation();
  const rows: Array<[string, string, boolean]> = step ? [
    [t("web.agents.process.detailTool"), stepLabel(t, step), false],
    [t("web.agents.process.detailParams"), formatParams(step.params), true],
    [t("web.agents.process.detailStatus"), t(`web.agents.process.status.${step.status}`), false],
    [t("web.agents.process.detailTime"), typeof step.ms === "number" ? t("web.agents.process.detailMs", { ms: step.ms }) : "—", false],
  ] : [];
  return (
    <BottomSheet open={!!step} onOpenChange={(open) => { if (!open) onClose(); }}>
      <BottomSheetContent data-testid="agent-step-sheet" className="max-h-[85dvh] overflow-y-auto">
        <BottomSheetHeader title={t("web.agents.process.detailTitle")} description={t("web.agents.process.detailHint")} />
        <dl className="divide-y-[0.5px] divide-hair-2 overflow-hidden rounded-card border-[0.5px] border-hair">
          {rows.map(([label, value, mono]) => (
            <div key={label} className="flex gap-2.5 px-3 py-2.5 text-sub">
              <dt className="w-16 flex-none text-meta text-ink-2">{label}</dt>
              <dd className={mono ? "min-w-0 flex-1 break-all font-mono text-meta text-ink" : "min-w-0 flex-1 font-medium text-ink"}>{value}</dd>
            </div>
          ))}
        </dl>
        <p className={`mt-2.5 flex gap-2 rounded-[10px] bg-blue-tint px-3 py-2 text-meta text-blue ${LQ_NOTE}`}>
          <ShieldCheckIcon aria-hidden className="mt-px h-4 w-4 flex-none" />{t("web.agents.process.privacy")}
        </p>
        <div className="mt-3.5 flex gap-2.5">
          <button type="button" onClick={onClose}
            className={`h-11 flex-1 rounded-button bg-surface-2 text-body font-semibold text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${LQ_SECONDARY}`}>
            {t("web.agents.common.close")}
          </button>
          {onRegenerate && (
            <button type="button" data-testid="agent-regenerate" onClick={() => { onClose(); onRegenerate(); }}
              className={`inline-flex h-11 flex-1 items-center justify-center gap-1.5 rounded-button bg-blue text-body font-semibold text-on-blue focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${LQ_PRIMARY}`}>
              <RefreshCwIcon aria-hidden className="h-4 w-4" />{t("web.agents.process.regenerate")}
            </button>
          )}
        </div>
      </BottomSheetContent>
    </BottomSheet>
  );
}
