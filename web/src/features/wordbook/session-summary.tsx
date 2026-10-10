import { CircleCheckIcon, GalleryVerticalEndIcon, KeyboardIcon, RefreshCwIcon, RotateCcwIcon, TrendingUpIcon } from "lucide-react";
import { useTranslation } from "react-i18next";
import { cn } from "@renderer/lib/utils";
import { IconChip } from "~/components/icon-chip";
import { SectionGroup } from "~/components/section-group";
import { StatTile } from "~/components/stat-tile";
import { SurfaceCard } from "~/components/surface-card";
import { NewAchievements } from "~/features/rank";
import { PlanRing } from "./plan-ring";
import { DOCK, GHOST, PRIMARY } from "./ui";
import { ListenButton, type ListenProps } from "./word-card";

export interface SessionStats {
  kind: "learn" | "review" | "spell";
  /** 本轮学会 / 复习的词数 */
  total: number;
  /** 第一次就答对的词数 */
  firstTry: number;
  /** 本轮进入「已掌握」(盒 ≥ 4)的词数(复习) */
  mastered?: number;
  /** 段位点估算;段位关闭时为 null */
  points: number | null;
  /** 需要再看看的词 */
  missed: { key: string; word: string; meaning: string }[];
}

/**
 * 会话小结(spec §11.2,视觉稿 10):正确率环(绿)、三张统计卡(段位点只在段位开启时显示,标「估算」)、
 * 需要再看看的词(可朗读)、底部「回到首页」与下一步。
 */
export function SessionSummary({ stats, onAgain, againLabel, onHome, onListen, listening, canListen }: ListenProps & {
  stats: SessionStats; onAgain?: () => void; againLabel?: string; onHome: () => void;
}) {
  const { t } = useTranslation();
  const rate = stats.total > 0 ? Math.round((stats.firstTry / stats.total) * 100) : 0;
  const line = [
    t(`web.wordbook.summary.${stats.kind}.count`, { n: stats.total }),
    t("web.wordbook.summary.firstTry", { n: stats.firstTry }),
    ...(stats.mastered ? [t("web.wordbook.summary.mastered", { n: stats.mastered })] : []),
  ].join(" · ");
  return (
    <>
      <div data-testid="session-summary" className="px-gutter pb-6">
        <SurfaceCard className="mt-2 px-4 py-[18px] text-center">
          <PlanRing done={stats.firstTry} target={stats.total} size={96} tone="green" label={`${rate}%`} className="mx-auto" />
          <h2 className="mt-3.5 text-headline font-semibold">{t(`web.wordbook.summary.${stats.kind}.title`)}</h2>
          <p role="status" className="mt-1 text-sub text-ink-2">{line}</p>
        </SurfaceCard>
        <div className={cn("mt-2 grid gap-2", stats.points === null ? "grid-cols-2" : "grid-cols-3")}>
          <StatTile tone="blue" icon={stats.kind === "learn" ? GalleryVerticalEndIcon : stats.kind === "spell" ? KeyboardIcon : RefreshCwIcon}
            label={t(`web.wordbook.summary.${stats.kind}.tile`)} value={stats.total} />
          <StatTile tone="green" icon={CircleCheckIcon} label={t("web.wordbook.summary.correct")} value={stats.firstTry} />
          {stats.points !== null ? (
            <StatTile tone="amber" icon={TrendingUpIcon} label={t("web.wordbook.summary.points")} value={`+${stats.points}`}
              unit={t("web.wordbook.summary.estimate")} />
          ) : null}
        </div>
        {/* 新解锁成就(spec §11.2,视觉稿 10):段位开启时才拉 /api/rank/me */}
        {stats.points !== null ? <NewAchievements title={t("web.wordbook.summary.newAchievements")} /> : null}
        {stats.missed.length ? (
          <SectionGroup title={t("web.wordbook.summary.missed")}>
            {stats.missed.map((m) => (
              <div key={m.key} className="flex min-h-row items-center gap-3 py-2.5 pl-3.5 pr-1.5">
                <IconChip tone="gray" icon={RotateCcwIcon} />
                <span className="min-w-0 flex-1">
                  <span lang="en" className="block text-body font-medium">{m.word}</span>
                  <span className="mt-0.5 block truncate text-meta text-ink-2">{t("web.wordbook.summary.missedHint", { meaning: m.meaning })}</span>
                </span>
                <ListenButton id={`${m.key}:sum`} text={m.word} label={t("web.wordbook.word.listen.word")}
                  onListen={onListen} listening={listening} canListen={canListen}
                  className="h-tap w-tap flex-none justify-center text-blue" />
              </div>
            ))}
          </SectionGroup>
        ) : null}
      </div>
      <div className={DOCK}>
        <button type="button" className={cn(GHOST, "h-12 flex-1")} onClick={onHome}>{t("web.wordbook.summary.home")}</button>
        {onAgain ? <button type="button" className={cn(PRIMARY, "h-12 flex-1")} onClick={onAgain}>{againLabel ?? t("web.wordbook.summary.again")}</button> : null}
      </div>
    </>
  );
}
