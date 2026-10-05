import { MicIcon, StarIcon } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link, useNavigate } from "react-router-dom";
import { Button } from "@renderer/components/ui/button";
import { translateServerError } from "~/api/error-messages";
import { useAuth } from "~/auth/auth-context";
import { goPractice, savePracticeItem } from "~/features/practice/save-practice-item";
import { AddVocabularyButton } from "~/features/vocabulary/add-vocabulary-button";
import { PageHeader } from "~/layout/page-header";
import { ScoreChart } from "./score-chart";
import { STATS_PERIODS, getStats, type Stats, type StatsPeriod } from "./stats-api";

function Card({ testId, label, value }: { testId: string; label: string; value: string | number }) {
  return (
    <div className="rounded-md border p-3">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p data-testid={testId} className="text-xl font-semibold tabular-nums">{value}</p>
    </div>
  );
}

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
      <div className="space-y-4 p-4">
        <div className="flex gap-2" role="group" aria-label={t("web.progress.period")}>
          {STATS_PERIODS.map((p) => (
            <Button key={p} variant={p === days ? "default" : "outline"} data-testid={`progress-days-${p}`} aria-pressed={p === days}
              className="h-11 flex-1" onClick={() => setDays(p)}>{t("web.progress.days", { value: p })}</Button>
          ))}
        </div>
        {error && (
          <div role="alert" className="flex items-center gap-2 text-sm text-destructive">
            <span data-testid="progress-error" className="flex-1">{error}</span>
            <Button variant="outline" data-testid="progress-retry" className="h-11" onClick={retry}>{t("web.common.retry")}</Button>
          </div>
        )}
        {!shown && !error && <p role="status" className="text-center text-muted-foreground">{t("web.common.loading")}</p>}
        {shown && (
          <>
            <p data-testid="progress-today" className="text-xs text-muted-foreground">{t("web.progress.asOf", { date: shown.today })}</p>
            <div className="grid grid-cols-2 gap-2">
              <Card testId="progress-active-days" label={t("web.progress.activeDays")} value={shown.activeDays} />
              <Card testId="progress-streak" label={t("web.progress.streak")} value={shown.streakDays} />
              <Card testId="progress-speaking" label={t("web.progress.speakingMinutes")} value={Math.round(shown.speakingSeconds / 60)} />
              <Card testId="progress-messages" label={t("web.progress.messages")} value={shown.userMessages} />
              <Card testId="progress-avg" label={t("web.progress.avgScore")}
                value={shown.avgPronunciation === null ? "—" : oneDecimal(shown.avgPronunciation)} />
            </div>
            {empty ? (
              <p data-testid="progress-empty" className="p-6 text-center text-muted-foreground">{t("web.progress.empty")}</p>
            ) : (
              <>
                <section>
                  <h2 className="mb-1 text-sm font-medium">{t("web.progress.chart")}</h2>
                  {scored.length === 0 ? (
                    <p data-testid="progress-no-scores" className="text-sm text-muted-foreground">{t("web.progress.noScores")}</p>
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
                </section>
                {shown.grammarTop.length > 0 && (
                  <section>
                    <h2 className="mb-1 text-sm font-medium">{t("web.progress.grammar")}</h2>
                    <ul className="space-y-1">
                      {shown.grammarTop.map((c) => {
                        const max = shown.grammarTop[0].count || 1;
                        return (
                          <li key={c.category} data-testid="progress-category" className="flex items-center gap-2 text-sm">
                            <span className="w-24 shrink-0 truncate">{t(`web.grammar.categories.${c.category}`, { defaultValue: t("web.grammar.categories.other") })}</span>
                            <span className="h-2 rounded bg-primary" style={{ width: `${Math.max(8, (c.count / max) * 100)}%` }} aria-hidden="true" />
                            <span className="tabular-nums">{c.count}</span>
                          </li>
                        );
                      })}
                    </ul>
                  </section>
                )}
                {shown.poorWords.length > 0 && (
                  <section>
                    <h2 className="mb-1 text-sm font-medium">{t("web.progress.words")}</h2>
                    <ul className="divide-y rounded-md border">
                      {shown.poorWords.map((w) => (
                        <li key={w.word} data-testid="progress-word" className="flex items-center gap-1 pl-3">
                          <span className="min-w-0 flex-1 truncate">{w.word} <span className="text-xs text-muted-foreground">×{w.count}</span></span>
                          <Button variant="ghost" size="sm" data-testid="progress-word-practice" className="h-11 min-w-11 px-2"
                            aria-label={`${t("web.progress.practice")}: ${w.word}`} onClick={() => goPractice(navigate, w.word)}><MicIcon className="h-4 w-4" /></Button>
                          <Button variant="ghost" size="sm" data-testid="progress-word-save" className="h-11 min-w-11 px-2"
                            aria-label={`${t("web.progress.save")}: ${w.word}`} onClick={() => void savePracticeItem(api, t, w.word, "chat")}><StarIcon className="h-4 w-4" /></Button>
                          <AddVocabularyButton testId="progress-word-vocab" label={`${t("web.vocabulary.add")}: ${w.word}`} input={{ word: w.word, source: "progress" }} />
                        </li>
                      ))}
                    </ul>
                  </section>
                )}
              </>
            )}
            {shown.truncated && <p data-testid="progress-truncated" className="text-xs text-muted-foreground">{t("web.progress.truncated")}</p>}
            <Button asChild variant="outline" className="h-11 w-full">
              <Link to="/vocabulary" data-testid="progress-vocabulary">{t("web.vocabulary.title")}</Link>
            </Button>
            <p data-testid="progress-disclaimer" className="text-xs text-muted-foreground">{t("web.progress.disclaimer")}</p>
          </>
        )}
      </div>
    </div>
  );
}
