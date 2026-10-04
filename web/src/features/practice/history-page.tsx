import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";
import { Button } from "@renderer/components/ui/button";
import { PronunciationAssessmentScoreIcon } from "@renderer/components/pronunciation-assessments/pronunciation-assessment-score-icon";
import { formatDateTime } from "@renderer/lib/utils";
import { translateServerError } from "~/api/error-messages";
import { useAuth } from "~/auth/auth-context";
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
      {error && (
        <div role="alert" className="flex items-center gap-2 p-4 text-sm text-destructive">
          <span className="flex-1">{error}</span>
          {!items.length && <Button variant="outline" className="h-11" onClick={() => void load(1)}>{t("web.common.retry")}</Button>}
        </div>
      )}
      {loaded && !items.length && !error && (
        <p data-testid="history-empty" className="p-8 text-center text-muted-foreground">{t("web.practice.empty")}</p>
      )}
      <ul>
        {items.map((a) => (
          <li key={a.id}>
            <Link to={`/practice/assessments/${a.id}`} data-testid="assessment-item"
              className="flex min-h-14 items-center gap-3 border-b px-4 py-3">
              <PronunciationAssessmentScoreIcon score={a.scores?.pronunciationScore ?? 0} />
              <div className="min-w-0 flex-1">
                <p className="truncate">{a.referenceText}</p>
                <p className="text-xs text-muted-foreground">{formatDateTime(a.createdAt)}</p>
              </div>
            </Link>
          </li>
        ))}
      </ul>
      {next && loaded && (
        <Button variant="ghost" data-testid="history-load-more" className="m-4 h-11" disabled={loading} onClick={() => void load(next)}>
          {t("web.common.loadMore")}
        </Button>
      )}
    </div>
  );
}
