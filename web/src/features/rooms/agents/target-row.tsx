import "./locales";
import { useTranslation } from "react-i18next";
import { cn } from "~/lib/cn";
import { ROOM_AGENTS } from "../protocol";
import type { RoomAgent } from "./room-agents-api";
import type { Recipient, TargetBlock } from "./target";
import { LQ_CHIP, LQ_CHIP_ON } from "~/components/liquid";

export interface TargetRowProps {
  agents: readonly RoomAgent[];
  /** 实际对准的角色(useAgentTarget.personaId) */
  activeId: string | null;
  on: boolean;
  block: TargetBlock | null;
  /** 这条消息会交给谁(recipientOf);null = 不提示 */
  recipient: Recipient | null;
  disabled: boolean;
  onToggle(personaId: string): void;
}

/**
 * 输入条上方的「对 Emma 说」行(spec addressing §3.2 第 2 条、§3.3):一个角色一个开关(两个角色 = 二选一);右侧常驻提示实际收件人
 * (「消息会交给 Emma」/「回复 Emma 中 · …」,R-AW7)或置灰原因。只对本人生效;单行、截断,360 px 不换行不跳动。
 */
export function TargetRow({ agents, activeId, on, block, recipient, disabled, onToggle }: TargetRowProps) {
  const { t } = useTranslation();
  if (!agents.length && !recipient) return null;
  const blockedName = agents.find((a) => a.id === activeId)?.name ?? "";
  const status = block ? t(`web.rooms.agents.target.off.${block}`, { name: blockedName })
    : recipient ? t(recipient.via === "reply" ? "web.rooms.agents.target.replying" : "web.rooms.agents.target.goesTo", { name: recipient.name }) : "";
  return (
    <div data-testid="room-target-row" className="mx-1 mb-1.5 flex min-h-8 min-w-0 items-center gap-1.5 plate liquid:rounded-full liquid:px-1.5">
      {agents.slice(0, ROOM_AGENTS.max).map((a) => {
        const pressed = on && !block && a.id === activeId;
        return (
          <button key={a.id} type="button" data-testid="room-target-chip" aria-pressed={pressed} disabled={disabled || !!block || a.disabled}
            onClick={() => onToggle(a.id)}
            className={cn("hit-expand relative inline-flex h-7 max-w-[132px] flex-none items-center rounded-full px-2.5 text-meta font-semibold",
              "transition-colors duration-fast motion-reduce:transition-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-40",
              pressed ? `bg-blue text-on-blue ${LQ_CHIP_ON}` : `bg-surface-2 text-ink-2 ${LQ_CHIP}`)}>
            <span className="truncate">{t("web.rooms.agents.target.to", { name: a.name })}</span>
          </button>
        );
      })}
      <span role="status" aria-live="polite" data-testid="room-target-status"
        className={cn("min-w-0 flex-1 truncate text-meta", block ? "text-ink-2" : "text-blue liquid:text-ink-2")}>{status}</span>
    </div>
  );
}
