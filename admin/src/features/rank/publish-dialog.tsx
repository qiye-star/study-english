import { ConfirmDialog } from "../../components/confirm-dialog";
import { DiffTable, type DiffRow, type DiffValue } from "../../components/diff-table";
import type { RankRules } from "./api";
import { diffPaths, getPath } from "./rules-schema";
import { DIMENSIONS, S, tierName } from "./strings";

const MAX_ROWS = 40;

/** 规则字段路径 → 中文标签(找不到时用路径本身) */
export function pathLabel(path: string): string {
  const p = path.split(".");
  if (p[0] === "tiers" && p[2] === "division_rp") return S.tiersTab.divisionRp(tierName(Number(p[1])));
  if (p[0] === "points" && p[1] === "assessment_bands") return p[3] === "0" ? S.tiersTab.bandFloor(Number(p[2]) + 1) : S.tiersTab.bandPoints(Number(p[2]) + 1);
  if (p[0] === "points" && p[1] in S.tiersTab) return String(S.tiersTab[p[1] as "daily_cap"]);
  if (p[0] === "match" && (p[1] === "turns" || p[1] === "thresholds"))
    return p[1] === "turns" ? S.matchTab.turnsOf(tierName(Number(p[2]))) : S.matchTab.thresholdOf(tierName(Number(p[2])));
  if (p[0] === "match" && p[1] === "llm_weights") return S.matchTab.weightLabel(DIMENSIONS[p[2]] ?? p[2]);
  if (p[0] === "match" && p[1] === "speech_weight") return S.matchTab.weightLabel(DIMENSIONS.speech);
  if (p[0] === "match" && p[1] === "examiner_prompt") return S.promptsTab.examiner;
  if (p[0] === "match" && p[1] === "judge_prompt") return S.promptsTab.judge;
  if (p[0] === "match" && p[1] in S.matchTab) return String(S.matchTab[p[1] as "daily_attempts"]);
  if (p[0] === "season") return p[1] === "anchor" ? S.seasonTab.anchor : S.seasonTab.weeks;
  if (p[0] === "stage_tasks") return S.stageTab.title(tierName(Number(p[1])));
  return path;
}

function asValue(v: unknown): DiffValue {
  if (v === undefined || v === null) return null;
  if (typeof v === "number" || typeof v === "boolean") return v;
  if (typeof v === "string") return v.length > 40 ? S.publish.changedText : v;
  return S.publish.changedText;
}

/** 草稿相对当前生效版本的改动(数值逐项列出;长文本只标"已修改";情景按条目汇总)。 */
export function changeRows(base: RankRules, draft: RankRules): DiffRow[] {
  const paths = diffPaths(base, draft);
  const rows: DiffRow[] = [];
  const seen = new Set<string>();
  for (const path of paths) {
    const parts = path.split(".");
    const key = parts[0] === "scenarios" || parts[0] === "stage_tasks" ? parts.slice(0, 2).join(".") : path;
    if (seen.has(key)) continue;
    seen.add(key);
    const label = parts[0] === "scenarios" ? `${S.scenariosTab.editTitle} ${parts[1]}` : parts[0] === "stage_tasks" ? `${S.stageTab.title(tierName(Number(parts[1])))}` : pathLabel(path);
    rows.push({ key, label, before: asValue(getPath(base, key)), after: asValue(getPath(draft, key)) });
  }
  return rows.slice(0, MAX_ROWS);
}

export function PublishDialog({
  open,
  base,
  draft,
  onConfirm,
  onClose,
}: {
  open: boolean;
  base: RankRules;
  draft: RankRules;
  onConfirm: (reason: string) => Promise<void>;
  onClose: () => void;
}) {
  const rows = open ? changeRows(base, draft) : [];
  return (
    <ConfirmDialog
      open={open}
      title={S.publish.title}
      body={S.publish.body}
      items={rows.length ? <DiffTable rows={rows} /> : <p className="text-xs text-fg-2">{S.publish.noChanges}</p>}
      reasonRequired
      onConfirm={onConfirm}
      onClose={onClose}
    />
  );
}
