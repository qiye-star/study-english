import { CircleCheckIcon, GalleryVerticalEndIcon, KeyboardIcon, RefreshCwIcon, RotateCcwIcon, TrendingUpIcon } from "lucide-react";
import { useTranslation } from "react-i18next";
import { cn } from "@renderer/lib/utils";
import { IconChip } from "~/components/icon-chip";
import { SectionGroup } from "~/components/section-group";
import { StatTile } from "~/components/stat-tile";
import { SurfaceCard } from "~/components/surface-card";
import { NewAchievements } from "~/features/rank";
import { PlanRing } from "./plan-ring";
import type { Rating } from "./session-machine";
import { lookupContext } from "~/lib/lookup-context";
import { DOCK, GHOST_DOCK, GHOST, PRIMARY } from "./ui";
import { Dock } from "~/components/dock";
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
  /** 三档自评的分布(学新词;复习里有快速回忆题时)。没有时不显示评级行 */
  ratings?: Record<Rating, number>;
  /** 本轮抽查数与通过数(学新词) */
  checks?: { total: number; passed: number };
}

const SPLIT: [Rating, string][] = [["know", "bg-green liquid:bg-ink/85"], ["fuzzy", "bg-amber liquid:bg-wash-2"], ["unknown", "bg-ink-3 liquid:bg-wash"]];

/**
 * 会话小结(spec §11.2,视觉稿 10):正确率环(绿)、三张统计卡(段位点只在段位开启时显示,标「估算」)、
 * 需要再看看的词(可朗读)、底部「回到首页」与下一步。
 */
export function SessionSummary({ stats, onAgain, againLabel, onHome, note, homeLabel, onListen, listening, canListen }: ListenProps & {
  stats: SessionStats; onAgain?: () => void; againLabel?: string; onHome: () => void; note?: string; homeLabel?: string;
}) {
  const { t } = useTranslation();
  const ratings = stats.ratings;
  const rate = stats.total > 0 ? Math.round((stats.firstTry / stats.total) * 100) : 0;
  const line = [
    t(`web.wordbook.summary.${stats.kind}.count`, { n: stats.total, count: stats.total }),
    t("web.wordbook.summary.firstTry", { n: stats.firstTry }),
    ...(stats.mastered ? [t("web.wordbook.summary.mastered", { n: stats.mastered, count: stats.mastered })] : []),
  ].join(" · ");
  return (
    <>
      <div data-testid="session-summary" className="px-gutter liquid:px-frame pb-6">
        <SurfaceCard className="mt-2 px-4 py-[18px] text-center">
          <PlanRing done={stats.firstTry} target={stats.total} size={96} tone="green" label={`${rate}%`} className="mx-auto" />
          <h2 className="mt-3.5 text-headline font-semibold">{t(`web.wordbook.summary.${stats.kind}.title`)}</h2>
          <p role="status" className="mt-1 text-sub text-ink-2">{line}</p>
          {note ? <p data-testid="summary-note" className="mt-1.5 text-meta text-ink-2">{note}</p> : null}
          {ratings ? (
            <>
              {/* 分布条只是装饰,数字在下面的文字里(视觉稿 08) */}
              <div aria-hidden className="mt-3.5 flex h-2 gap-0.5 overflow-hidden rounded-[4px]">
                {SPLIT.map(([r, tone]) => (ratings[r] > 0 ? <i key={r} className={cn("block h-full", tone)} style={{ flex: ratings[r] }} /> : null))}
              </div>
              <p data-testid="summary-ratings" className="mt-2 text-meta text-ink-2">
                {t("web.wordbook.recall.summary.ratings", ratings)}
                {stats.checks?.total ? ` · ${t("web.wordbook.recall.summary.checks", stats.checks)}` : ""}
              </p>
            </>
          ) : null}
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
                  <span lang="en" {...lookupContext} className="block text-body font-medium">{m.word}</span>
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
      <Dock className={DOCK}>
        <button type="button" className={cn(GHOST_DOCK, "h-12 flex-1")} onClick={onHome}>{homeLabel ?? t("web.wordbook.summary.home")}</button>
        {onAgain ? <button type="button" className={cn(PRIMARY, "h-12 flex-1")} onClick={onAgain}>{againLabel ?? t("web.wordbook.summary.again")}</button> : null}
      </Dock>
    </>
  );
}
