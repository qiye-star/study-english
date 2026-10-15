import { useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { translateServerError } from "~/api/error-messages";
import { useAuth } from "~/auth/auth-context";
import { BottomSheet, BottomSheetContent, BottomSheetHeader } from "~/components/bottom-sheet";
import { levelLabel } from "~/lib/levels";
import { ghostButton } from "../ui";
import { reportRoomAgent, ROOM_AGENTS_ALL_ERRORS, type AgentReportReason, type RoomAgent } from "./room-agents-api";
import { LQ_CHIP } from "~/components/liquid";

const REASONS: AgentReportReason[] = ["spam", "abuse", "other"];
// One meaning per hue: teal = vocabulary, amber = private data, red = failure; these facts are neutral chips.
const chip = `rounded-full bg-surface-2 px-2 py-0.5 text-ink-2 ${LQ_CHIP}`;

/**
 * 角色信息(spec D3 / §9.1):名字、简介、水平、风格;创建者公开时显示人设原文(纯文本,React 转义),否则说明「没有公开」。
 * 「@名字 提问」把提及插进输入框(不直接发送);举报走房间端点(成员 + 本房角色),同一角色本次只能举报一次。
 */
export function PersonaSheet({ open, onOpenChange, roomId, agent, canAsk, onAsk }: {
  open: boolean; onOpenChange(v: boolean): void; roomId: string; agent: RoomAgent | null; canAsk: boolean; onAsk(name: string): void;
}) {
  const { api } = useAuth();
  const { t } = useTranslation();
  const [reporting, setReporting] = useState(false);
  const [reported, setReported] = useState<ReadonlySet<string>>(() => new Set());
  if (!agent) return null;
  const current = agent;
  async function report(reason: AgentReportReason) {
    try {
      await reportRoomAgent(api, roomId, current.id, reason);
      setReported((cur) => new Set(cur).add(current.id));
      setReporting(false);
      toast.success(t("web.rooms.agents.sheet.reported"));
    } catch (err) {
      toast.error(translateServerError(t, err, ROOM_AGENTS_ALL_ERRORS));
    }
  }
  return (
    <BottomSheet open={open} onOpenChange={(v) => { if (!v) setReporting(false); onOpenChange(v); }}>
      <BottomSheetContent className="max-h-[85dvh] overflow-y-auto">
        <BottomSheetHeader title={current.name} description={current.intro} />
        <div className="flex flex-wrap gap-1.5 text-label">
          {current.builtin && <span className={chip}>{t("web.rooms.agents.sheet.builtin")}</span>}
          {current.disabled && <span className={chip}>{t("web.rooms.agents.sheet.disabled")}</span>}
          <span className={chip}>{levelLabel(t, current.level)}</span>
          <span className={chip}>{t(`web.rooms.agents.sheet.style.${current.style}`, { defaultValue: current.style })}</span>
        </div>
        <section className="mt-section">
          <h3 className="mx-0.5 mb-2 text-sub font-semibold text-ink-2">{t("web.rooms.agents.sheet.prompt")}</h3>
          {current.promptPublic && current.prompt ? (
            <p data-testid="persona-prompt" className="whitespace-pre-wrap break-words rounded-card border-[0.5px] border-hair bg-surface px-3 py-2.5 text-sub leading-dialogue text-ink">
              {current.prompt}
            </p>
          ) : <p className="mx-0.5 text-sub text-ink-2">{t("web.rooms.agents.sheet.promptHidden")}</p>}
        </section>
        <div className="mt-section space-y-2">
          {canAsk && !current.disabled && (
            <button type="button" className={ghostButton} onClick={() => { onAsk(current.name); onOpenChange(false); }}>
              {t("web.rooms.agents.sheet.ask", { name: current.name })}
            </button>
          )}
          {reported.has(current.id) ? (
            <p role="status" className="text-center text-sub text-ink-2">{t("web.rooms.agents.sheet.reported")}</p>
          ) : reporting ? REASONS.map((reason) => (
            <button key={reason} type="button" className={ghostButton} onClick={() => void report(reason)}>
              {t(`web.rooms.agents.sheet.reportReasons.${reason}`)}
            </button>
          )) : (
            <button type="button" className="tap-link block w-full text-center text-sub text-red" onClick={() => setReporting(true)}>
              {t("web.rooms.agents.sheet.report")}
            </button>
          )}
        </div>
      </BottomSheetContent>
    </BottomSheet>
  );
}
