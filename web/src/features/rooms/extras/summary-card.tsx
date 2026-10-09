import { ChevronRightIcon, LoaderIcon, NotebookPenIcon } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";
import { cn } from "~/lib/cn";
import { smallGhostButton } from "../ui";
import { useRoomSummary } from "./use-room-summary";

const card = "mb-3 flex items-center gap-3 rounded-card bg-surface py-2.5 pl-3.5 pr-2 shadow-hair";

/**
 * 已结束房间列表顶部的「学习小结」卡片(spec §6.1):
 * done →「学习小结 · 3 个新词 · 2 句可以说得更好」+「查看」(到 /rooms/r/:roomId/summary);pending →「正在生成小结…」(每 3 秒轮询,最多 60 秒);
 * failed →「小结生成失败」+「重试」;skipped / none / 取不到 → 不渲染。房间页只在房间已结束时渲染它。
 */
export function SummaryCard({ roomId }: { roomId: string }): JSX.Element | null {
  const { t } = useTranslation();
  const { summary, error, timedOut, retrying, retry } = useRoomSummary(roomId);
  if (error || !summary) return null;
  const icon = (
    <span aria-hidden className="inline-flex size-[34px] flex-none items-center justify-center rounded-badge bg-blue-tint text-blue">
      <NotebookPenIcon className="size-[19px]" />
    </span>
  );
  if (summary.status === "pending") {
    return (
      <div data-testid="summary-card" role="status" className={card}>
        {icon}
        <span className="flex min-w-0 flex-1 items-center gap-1.5 text-sub text-ink-2">
          {!timedOut && <LoaderIcon aria-hidden className="size-3.5 flex-none animate-spin" />}
          {timedOut ? t("web.rooms.extras.summary.later") : t("web.rooms.extras.summary.pending")}
        </span>
      </div>
    );
  }
  if (summary.status === "failed") {
    return (
      <div data-testid="summary-card" className={card}>
        {icon}
        <span className="min-w-0 flex-1 text-sub text-ink-2">{t("web.rooms.extras.summary.failed")}</span>
        <button type="button" disabled={retrying} className={cn(smallGhostButton, "flex-none")} onClick={retry}>{t("web.common.retry")}</button>
      </div>
    );
  }
  if (summary.status !== "done") return null;
  const parts = [
    t("web.rooms.extras.summary.words", { count: summary.words.length }),
    ...(summary.myFixes.length ? [t("web.rooms.extras.summary.fixes", { count: summary.myFixes.length })] : []),
  ];
  return (
    <div data-testid="summary-card" className={card}>
      {icon}
      <span className="min-w-0 flex-1">
        <span className="block text-body font-semibold tracking-[-0.005em] text-ink">{t("web.rooms.extras.summary.title")}</span>
        <span className="mt-0.5 block truncate text-meta tabular-nums text-ink-2">{parts.join(" · ")}</span>
      </span>
      <Link to={`/rooms/r/${encodeURIComponent(roomId)}/summary`}
        className="inline-flex min-h-tap flex-none items-center gap-0.5 rounded-button px-2 text-sub font-semibold text-blue focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
        {t("web.rooms.extras.summary.view")}<ChevronRightIcon aria-hidden className="size-4" />
      </Link>
    </div>
  );
}
