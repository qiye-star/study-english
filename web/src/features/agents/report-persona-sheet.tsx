import "./locales";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { useAuth } from "~/auth/auth-context";
import { BottomSheet, BottomSheetContent, BottomSheetHeader } from "~/components/bottom-sheet";
import { cn } from "~/lib/cn";
import { agentsApi, type ReportReason } from "./agents-api";
import type { Persona } from "./types";

const REASONS: readonly ReportReason[] = ["unsafe", "offensive", "spam", "other"];

export interface ReportPersonaSheetProps {
  persona: Pick<Persona, "id" | "name"> | null;
  onClose(): void;
  onReported?(): void;
}

/**
 * 举报角色(联机里成员可举报,spec §9.1)。只发原因,不附带任何对话内容。
 * Ruling: 服务端 ReportIn 只有 reason(extra=forbid),所以没有自由备注字段。
 */
export function ReportPersonaSheet({ persona, onClose, onReported }: ReportPersonaSheetProps) {
  const { t } = useTranslation();
  const { api } = useAuth();
  const [reason, setReason] = useState<ReportReason | null>(null);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    setReason(null);
    setFailed(false);
  }, [persona?.id]);

  const submit = async () => {
    if (!persona || !reason || busy) return;
    setBusy(true);
    setFailed(false);
    try {
      await agentsApi.reportPersona(api, persona.id, { reason });
      toast.success(t("web.agents.report.done"));
      onReported?.();
      onClose();
    } catch {
      setFailed(true);
    } finally {
      setBusy(false);
    }
  };

  return (
    <BottomSheet open={!!persona} onOpenChange={(open) => { if (!open) onClose(); }}>
      <BottomSheetContent data-testid="agent-report-sheet" className="max-h-[85dvh] overflow-y-auto">
        <BottomSheetHeader title={t("web.agents.report.title")} description={persona?.name} />
        <p className="mb-1.5 text-meta text-ink-2" id="agent-report-reason">{t("web.agents.report.reason")}</p>
        <div role="radiogroup" aria-labelledby="agent-report-reason" className="divide-y-[0.5px] divide-hair-2 overflow-hidden rounded-card border-[0.5px] border-hair">
          {REASONS.map((r) => (
            <button key={r} type="button" role="radio" aria-checked={reason === r} data-testid={`agent-report-reason-${r}`} onClick={() => setReason(r)}
              className={cn("flex min-h-row w-full items-center px-3 text-left text-body focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring",
                reason === r ? "font-semibold text-blue" : "text-ink")}>
              {t(`web.agents.report.reasons.${r}`)}
            </button>
          ))}
        </div>
        {failed && <p role="alert" className="mt-2 text-sub text-red">{t("web.agents.report.failed")}</p>}
        <button type="button" data-testid="agent-report-submit" disabled={!reason || busy} onClick={() => void submit()}
          className="mt-3.5 h-12 w-full rounded-button bg-blue text-body font-semibold text-on-blue disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
          {t("web.agents.report.submit")}
        </button>
      </BottomSheetContent>
    </BottomSheet>
  );
}
