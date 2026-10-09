import { useTranslation } from "react-i18next";
import { cn } from "~/lib/cn";
import { REACTION_GLYPHS, type ReactionInfo, type ReactionKey } from "../protocol";

/**
 * 气泡下方的回应片「👍 2」(spec §6.4,视觉稿 V12 .rx):26px 高、13px、等宽数字;自己点过的片 blue-tint + 蓝字,点击切换。
 * 命中区用 ::before 上下各扩 9px 到 44px。没有回应(或名单都空)时不渲染。
 */
export function ReactionBar({ reactions, meId, onToggle }: {
  reactions: ReactionInfo[]; meId: number | null; onToggle(key: ReactionKey, on: boolean): void;
}): JSX.Element | null {
  const { t } = useTranslation();
  const shown = reactions.filter((r) => r.userIds.length > 0 && r.key in REACTION_GLYPHS);
  if (!shown.length) return null;
  return (
    <div className="mt-1 flex flex-wrap gap-1">
      {shown.map((r) => {
        const mine = meId !== null && r.userIds.includes(meId);
        return (
          <button key={r.key} type="button" data-testid={`reaction-${r.key}`} aria-pressed={mine}
            aria-label={t("web.rooms.extras.reactionChip", { name: t(`web.rooms.extras.reactionNames.${r.key}`), count: r.userIds.length })}
            onClick={() => onToggle(r.key, !mine)}
            className={cn("relative inline-flex h-[26px] items-center gap-1 rounded-[13px] px-[9px] text-sub tabular-nums transition-colors duration-fast",
              "before:absolute before:inset-x-0 before:-inset-y-[9px] before:content-[''] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
              mine ? "bg-blue-tint font-semibold text-blue" : "bg-surface-2 text-ink")}>
            <span aria-hidden>{REACTION_GLYPHS[r.key]}</span>
            <span aria-hidden>{r.userIds.length}</span>
          </button>
        );
      })}
    </div>
  );
}
