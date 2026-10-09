import { FlagIcon } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { ReactionKey, RoomMessage } from "../protocol";

/**
 * 点(或长按)一条公共消息后气泡下方的操作行(spec §6.4):6 个表情 +「引用」「译」「朗读」「举报」(自己的消息没有举报);44px 命中区。
 * 车道 WE,任务 WE1 替换实现,签名不变。房间页只在消息被选中时渲染它;canReport=false 表示不显示举报(自己的消息)。
 *
 * F5 桩:沿用 v1 —— 可举报时显示「举报」键(data-testid="room-report"),已举报显示「已举报」;其余不渲染。
 */
export function MessageActions({ canReport, reported, onReport }: {
  message: RoomMessage; mine: boolean; meId: number | null; canReport: boolean; reported: boolean;
  onReact(key: ReactionKey, on: boolean): void; onQuote(): void; onReport(): void;
}): JSX.Element {
  const { t } = useTranslation();
  if (!canReport) return <></>;
  return reported ? (
    <span className="inline-flex h-tap items-center px-2 text-meta font-medium text-ink-2">{t("web.rooms.room.reported")}</span>
  ) : (
    <button type="button" data-testid="room-report" onClick={onReport}
      className="inline-flex h-tap items-center gap-1 rounded-[9px] px-2 text-meta font-medium text-ink-2 hover:bg-surface-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring [&_svg]:size-[15px]">
      <FlagIcon aria-hidden />{t("web.rooms.room.report")}
    </button>
  );
}
