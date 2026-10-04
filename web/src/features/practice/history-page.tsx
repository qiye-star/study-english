import { useCallback, useEffect, useState } from "react";
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
  const [next, setNext] = useState<number | null>(1);
  const [loading, setLoading] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (page: number) => {
    setLoading(true);
    try {
      const res = await listAssessments(api, page);
      setItems((prev) => (page === 1 ? res.assessments : [...prev, ...res.assessments]));
      setNext(res.next);
      setError(null);
    } catch (err) {
      setError(translateServerError(t, err));
    } finally {
      setLoading(false);
      setLoaded(true);
    }
  }, [api, t]);

  useEffect(() => { void load(1); }, [load]);

  return (
    <div className="flex flex-1 flex-col">
      <PageHeader title={t("web.practice.historyTitle")} back="/practice" />
      {error && <p role="alert" className="p-4 text-sm text-destructive">{error}</p>}
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
