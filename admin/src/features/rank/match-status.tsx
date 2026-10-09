import type { MatchRow } from "./api";
import { GATES, MATCH_STATUS } from "./strings";

/** 比赛状态徽标:通过 = 绿、未通过 = 中性、作废 = 中性删除线、评分失败 = 琥珀、进行中 = 蓝 */
export function MatchStatusBadge({ match }: { match: Pick<MatchRow, "status" | "gatesFailed"> }) {
  const label = MATCH_STATUS[match.status] ?? match.status;
  switch (match.status) {
    case "passed":
      return <span className="badge bg-good-soft text-fg">{label}</span>;
    case "grading_failed":
      return <span className="badge bg-warn-soft text-fg">{label}</span>;
    case "active":
      return <span className="badge bg-accent-soft text-fg">{label}</span>;
    case "voided":
      return <span className="badge bg-sunken text-fg-2 line-through">{label}</span>;
    case "failed": {
      const gate = match.gatesFailed?.[0];
      return <span className="badge bg-sunken text-fg-2">{gate ? `${label} · ${GATES[gate] ?? gate}` : label}</span>;
    }
    default:
      return <span className="badge bg-sunken text-fg-2">{label}</span>;
  }
}

export const VOIDABLE = new Set(["failed", "expired", "abandoned", "grading_failed"]);
