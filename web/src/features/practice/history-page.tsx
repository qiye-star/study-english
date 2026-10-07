import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";
import { ChevronRightIcon } from "lucide-react";
import { Button } from "@renderer/components/ui/button";
import { cn, formatDateTime } from "@renderer/lib/utils";
import { translateServerError } from "~/api/error-messages";
import { useAuth } from "~/auth/auth-context";
import { LIST_CARD, PAGE_NOTE } from "~/components/list-card";
import { scoreToneClass } from "~/components/score-tone";
import { PageHeader } from "~/layout/page-header";
import { listAssessments, type AssessmentSummary } from "./assessment-api";

export function HistoryPage() {
  const { api } = useAuth();
  const { t } = useTranslation();
  const [items, setItems] = useState<AssessmentSummary[]>([]);
  const [next, setNext] = useState<number | null>(null);
  const [loading, setLoading] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const tRef = useRef(t);
  tRef.current = t;
  const loadingRef = useRef(false);

  const load = useCallback(async (page: number) => {
    if (loadingRef.current) return;
    loadingRef.current = true;
    setLoading(true);
    setError(null);
    try {
      const res = await listAssessments(api, page);
      setItems((prev) => {
        const base = page === 1 ? [] : prev;
        const seen = new Set(base.map((a) => a.id));
        return [...base, ...res.assessments.filter((a) => !seen.has(a.id))];
      });
      setNext(res.next);
    } catch (err) {
      setError(translateServerError(tRef.current, err));
    } finally {
      loadingRef.current = false;
      setLoading(false);
      setLoaded(true);
    }
  }, [api]);

  useEffect(() => { void load(1); }, [load]);

  return (
    <div className="flex flex-1 flex-col">
      <PageHeader title={t("web.practice.historyTitle")} back="/practice" />
      <div className="px-gutter pb-6 pt-2">
        {error && (
          <div role="alert" className="mb-3 flex items-center gap-2 text-sub text-destructive">
            <span className="flex-1">{error}</span>
            {!items.length && <Button variant="outline" className="h-tap" onClick={() => void load(1)}>{t("web.common.retry")}</Button>}
          </div>
        )}
        {loaded && !items.length && !error && (
          <p data-testid="history-empty" className={PAGE_NOTE}>{t("web.practice.empty")}</p>
        )}
        {items.length > 0 && (
          <ul className={LIST_CARD}>
            {items.map((a) => {
              const score = a.scores?.pronunciationScore;
              const scored = typeof score === "number" && Number.isFinite(score);
              return (
                <li key={a.id}>
                  <Link to={`/practice/assessments/${a.id}`} data-testid="assessment-item"
                    className="flex min-h-row items-center gap-3 py-2.5 pl-3.5 pr-3 transition-colors duration-fast active:bg-surface-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring">
                    <span className={cn("num w-10 flex-none text-center text-headline font-semibold tracking-tightest", scored ? scoreToneClass(score) : "text-ink-2")}>
                      {scored ? Math.round(score) : "—"}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-body font-medium tracking-[-0.005em] text-ink">{a.referenceText}</span>
                      <span className="mt-0.5 block text-meta text-ink-2">{formatDateTime(a.createdAt)}</span>
                    </span>
                    <ChevronRightIcon aria-hidden className="h-[18px] w-[18px] flex-none text-ink-3" />
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
        {next && loaded && (
          <Button variant="ghost" data-testid="history-load-more" className="mt-3 h-tap w-full text-blue" disabled={loading} onClick={() => void load(next)}>
            {t("web.common.loadMore")}
          </Button>
        )}
      </div>
    </div>
  );
}
