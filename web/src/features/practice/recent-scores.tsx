import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";
import { useAuth } from "~/auth/auth-context";
import { LQ_WELL } from "~/components/liquid";
import { ScoreDot } from "~/components/score-dot";
import { SectionGroup } from "~/components/section-group";
import { cn } from "~/lib/cn";
import { listAssessments, type AssessmentSummary } from "./assessment-api";

/**
 * 练习首页「最近评分」(设计稿 practice() 的 .wells):最近 3 次评测,数字墨色 + 6px 分数点,点进结果页。
 * 只在液态皮肤下挂载(计划 2026-10-15-liquid-glass R-L4-2);没有结果或请求失败时不显示。
 */
export function RecentScores() {
  const { api } = useAuth();
  const { t, i18n } = useTranslation();
  const [items, setItems] = useState<AssessmentSummary[] | null>(null);
  useEffect(() => {
    let alive = true;
    listAssessments(api, 1, 3).then(
      (res) => { if (alive) setItems(res.assessments.slice(0, 3)); },
      () => { if (alive) setItems([]); },
    );
    return () => { alive = false; };
  }, [api]);
  if (!items?.length) return null;
  const day = (iso: string) => {
    const d = new Date(iso);
    return Number.isNaN(d.getTime()) ? "" : d.toLocaleDateString(i18n.language, { month: "numeric", day: "numeric" });
  };
  return (
    <SectionGroup title={t("web.practice.home.recent")}
      action={<Link to="/practice/history" className="tap-link text-sub font-semibold text-blue">{t("web.practice.home.all")} ›</Link>}>
      <div className="grid grid-cols-3 gap-2.5 px-4 pb-3 pt-1">
        {items.map((a) => {
          const score = a.scores?.pronunciationScore;
          const scored = typeof score === "number" && Number.isFinite(score);
          return (
            <Link key={a.id} to={`/practice/assessments/${a.id}`} data-testid="recent-score" className={cn("block px-3 py-2.5", LQ_WELL)}>
              <b className="num block text-headline font-bold tracking-tightest text-ink">{scored ? Math.round(score) : "—"}</b>
              <span className="flex items-center gap-1.5 text-meta text-ink-2">{scored ? <ScoreDot score={score} /> : null}{day(a.createdAt)}</span>
            </Link>
          );
        })}
      </div>
    </SectionGroup>
  );
}
