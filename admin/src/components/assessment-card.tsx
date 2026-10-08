import { Link } from "react-router-dom";
import type { AssessmentItem } from "../api/types";
import { formatDuration, formatRelative, formatScore, scoreTone, TONE_SOFT } from "../lib/format";
import { S } from "../strings";
import { ChevronIcon } from "./icons";

/** 录音列表行:左侧分数块,中间参考文本与元信息 */
export function AssessmentCard({ item, showUser = false }: { item: AssessmentItem; showUser?: boolean }) {
  const score = item.scores?.pronunciation_score;
  const tone = scoreTone(score);
  return (
    <li>
      <Link to={`/assessments/${encodeURIComponent(item.id)}`} className="row-link">
        <div className={`num flex h-11 w-11 shrink-0 flex-col items-center justify-center rounded-lg text-md font-semibold leading-none ${TONE_SOFT[tone]}`} aria-label={`${S.assessments.scores.pronunciation_score} ${formatScore(score)}`}>
          {formatScore(score)}
        </div>
        <div className="min-w-0 flex-1">
          <p className="line-clamp-2 break-words text-base leading-snug">{item.reference_text || "—"}</p>
          <p className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-muted">
            <span className={`chip ${item.source === "chat" ? "bg-accent-soft text-accent" : "bg-sunken text-fg-2"}`}>{S.assessments.source[item.source] ?? item.source}</span>
            <span className="num">{formatDuration(item.duration_ms)}</span>
            <span aria-hidden="true">·</span>
            <span>{formatRelative(item.created_at)}</span>
            {showUser && item.username && (
              <>
                <span aria-hidden="true">·</span>
                <span className="truncate font-medium text-fg-2">@{item.username}</span>
              </>
            )}
          </p>
        </div>
        <ChevronIcon className="shrink-0 text-line-strong" width={18} height={18} />
      </Link>
    </li>
  );
}
