import { BarChart3Icon, BookOpenIcon, CalendarCheckIcon, ClockIcon, FlameIcon, MessageSquareIcon, MicIcon, StarIcon } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";
import { Button } from "@renderer/components/ui/button";
import { cn } from "@renderer/lib/utils";
import { translateServerError } from "~/api/error-messages";
import { useAuth } from "~/auth/auth-context";
import { IconButton } from "~/components/icon-button";
import { IconChip } from "~/components/icon-chip";
import { LIST_CARD, PAGE_NOTE } from "~/components/list-card";
import { ListRow, SectionGroup } from "~/components/section-group";
import { StatTile } from "~/components/stat-tile";
import { SurfaceCard } from "~/components/surface-card";
import { goPractice, savePracticeItem } from "~/features/practice";
import { AddVocabularyButton } from "~/features/vocabulary";
import { PageHeader } from "~/layout/page-header";
import { ScoreChart } from "./score-chart";
import { STATS_PERIODS, getStats, type Stats, type StatsPeriod } from "./stats-api";

const oneDecimal = (n: number) => Math.round(n * 10) / 10;

export function ProgressPage() {
  const { api } = useAuth();
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [days, setDays] = useState<StatsPeriod>(7);
  const [stats, setStats] = useState<Stats | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const tRef = useRef(t);
  tRef.current = t;

  // 副作用自己持有 AbortController:换周期/重试/卸载/StrictMode 重跑都会中止上一次,迟到的响应被忽略
  useEffect(() => {
    const controller = new AbortController();
    setError(null);
    getStats(api, days, controller.signal).then(
      (s) => { if (!controller.signal.aborted) setStats(s); },
      (err) => { if (!controller.signal.aborted) setError(translateServerError(tRef.current, err)); },
    );
    return () => controller.abort();
  }, [api, days, attempt]);

  const retry = useCallback(() => setAttempt((n) => n + 1), []);
  // 第二道保险:只展示与当前周期一致的数据
  const shown = stats && stats.days === days ? stats : null;
  const empty = !!shown && shown.activeDays === 0;
  const scored = shown ? shown.daily.filter((d) => d.avgPronunciation !== null) : [];

  return (
    <div className="flex flex-1 flex-col">
      <PageHeader title={t("web.progress.title")} back="/me" />
      <div className="px-gutter pb-6 pt-1">
        {/* 分段外观(轨道 + 选中片),保留 aria-pressed 按钮语义 */}
        <div className="flex rounded-badge bg-seg-track p-[3px]" role="group" aria-label={t("web.progress.period")}>
          {STATS_PERIODS.map((p) => (
            <button key={p} type="button" data-testid={`progress-days-${p}`} aria-pressed={p === days} onClick={() => setDays(p)}
              className={cn(
                "hit-expand relative h-8 flex-1 rounded-[8px] text-[13px] transition-colors duration-fast focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                p === days ? "border-[0.5px] border-hair-2 bg-seg-on font-semibold text-ink shadow-seg" : "font-medium text-ink-2",
              )}>
              {t("web.progress.days", { value: p })}
            </button>
          ))}
        </div>
        {error && (
          <div role="alert" className="mt-4 flex items-center gap-2 text-sub text-destructive">
            <span data-testid="progress-error" className="flex-1">{error}</span>
            <Button variant="outline" data-testid="progress-retry" className="h-tap" onClick={retry}>{t("web.common.retry")}</Button>
          </div>
        )}
        {!shown && !error && <p role="status" className={PAGE_NOTE}>{t("web.common.loading")}</p>}
        {shown && (
          <>
            <p data-testid="progress-today" className="mx-0.5 mt-4 text-meta text-ink-2">{t("web.progress.asOf", { date: shown.today })}</p>
            <div className="mt-2 grid grid-cols-3 gap-2">
              <StatTile tone="amber" icon={FlameIcon} label={t("web.progress.tiles.streak")} unit={t("web.progress.tiles.daysUnit")}
                value={<span data-testid="progress-streak">{shown.streakDays}</span>} />
              <StatTile tone="blue" icon={ClockIcon} label={t("web.progress.tiles.speaking")} unit={t("web.progress.tiles.minutesUnit")}
                value={<span data-testid="progress-speaking">{Math.round(shown.speakingSeconds / 60)}</span>} />
              <StatTile tone="green" icon={BarChart3Icon} label={t("web.progress.tiles.avg")}
                value={<span data-testid="progress-avg">{shown.avgPronunciation === null ? "—" : oneDecimal(shown.avgPronunciation)}</span>} />
            </div>
            <SectionGroup title={t("web.progress.activity")}>
              <ListRow icon={<IconChip tone="gray" icon={CalendarCheckIcon} />} title={t("web.progress.activeDays")}
                value={<span data-testid="progress-active-days" className="num text-ink">{shown.activeDays}</span>} />
              <ListRow icon={<IconChip tone="gray" icon={MessageSquareIcon} />} title={t("web.progress.messages")}
                value={<span data-testid="progress-messages" className="num text-ink">{shown.userMessages}</span>} />
            </SectionGroup>
            {empty ? (
              <p data-testid="progress-empty" className={PAGE_NOTE}>{t("web.progress.empty")}</p>
            ) : (
              <>
                <SectionGroup title={t("web.progress.chart")} bare>
                  <SurfaceCard className="p-3.5">
                    {scored.length === 0 ? (
                      <p data-testid="progress-no-scores" className="text-sub text-ink-2">{t("web.progress.noScores")}</p>
                    ) : (
                      <>
                        <ScoreChart daily={shown.daily} label={t("web.progress.chart")}
                          description={t("web.progress.chartDesc", { scored: scored.length, total: shown.daily.length })} />
                        {/* 图的文字替代:逐日分数列表(只给读屏器) */}
                        <ul className="sr-only" aria-label={t("web.progress.chartList")}>
                          {scored.map((d) => (
                            <li key={d.date} data-testid="progress-chart-day">
                              {t("web.progress.chartDay", { date: d.date, score: oneDecimal(d.avgPronunciation as number) })}
                            </li>
                          ))}
                        </ul>
                      </>
                    )}
                  </SurfaceCard>
                </SectionGroup>
                {shown.grammarTop.length > 0 && (
                  <SectionGroup title={t("web.progress.grammar")} bare>
                    <SurfaceCard as="ul" className="space-y-2.5 px-3.5 py-3">
                      {shown.grammarTop.map((c) => {
                        const max = shown.grammarTop[0].count || 1;
                        return (
                          <li key={c.category} data-testid="progress-category" className="flex items-center gap-3 text-sub">
                            <span className="w-28 shrink-0 truncate text-ink">{t(`web.grammar.categories.${c.category}`, { defaultValue: t("web.grammar.categories.other") })}</span>
                            <span className="h-1.5 min-w-0 flex-1 overflow-hidden rounded-full bg-surface-2" aria-hidden="true">
                              <span className="block h-full rounded-full bg-ink-3" style={{ width: `${Math.max(8, (c.count / max) * 100)}%` }} />
                            </span>
                            <span className="num w-6 text-right text-ink-2">{c.count}</span>
                          </li>
                        );
                      })}
                    </SurfaceCard>
                  </SectionGroup>
                )}
                {shown.poorWords.length > 0 && (
                  <SectionGroup title={t("web.progress.words")}>
                    {shown.poorWords.map((w) => (
                      <div key={w.word} data-testid="progress-word" className="flex min-h-row items-center gap-1 pl-3.5 pr-1">
                        <span className="min-w-0 flex-1 truncate text-body font-medium text-ink">
                          {w.word} <span className="num text-meta font-normal text-ink-2">×{w.count}</span>
                        </span>
                        <IconButton label={`${t("web.progress.practice")}: ${w.word}`} tone="blue" data-testid="progress-word-practice"
                          onClick={() => goPractice(navigate, w.word)}><MicIcon /></IconButton>
                        <IconButton label={`${t("web.progress.save")}: ${w.word}`} data-testid="progress-word-save" className="text-ink-2"
                          onClick={() => void savePracticeItem(api, t, w.word, "chat")}><StarIcon /></IconButton>
                        <AddVocabularyButton testId="progress-word-vocab" label={`${t("web.vocabulary.add")}: ${w.word}`} input={{ word: w.word, source: "progress" }} />
                      </div>
                    ))}
                  </SectionGroup>
                )}
              </>
            )}
            {shown.truncated && <p data-testid="progress-truncated" className="mx-0.5 mt-3 text-meta text-ink-2">{t("web.progress.truncated")}</p>}
            <div className={cn(LIST_CARD, "mt-section")}>
              <ListRow icon={<IconChip tone="teal" icon={BookOpenIcon} />} title={t("web.vocabulary.title")} to="/vocabulary" testId="progress-vocabulary" />
            </div>
            <p data-testid="progress-disclaimer" className="mx-0.5 mt-3 text-meta text-ink-2">{t("web.progress.disclaimer")}</p>
          </>
        )}
      </div>
    </div>
  );
}
