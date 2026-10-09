import type { ReactNode } from "react";
import { AlertIcon, SpinnerIcon } from "../../components/icons";
import type { Impact } from "./api";
import { S, TIER_KEYS, tierName } from "./strings";

const percent = (part: number, whole: number) => (whole > 0 ? `${Math.round((part / whole) * 100)}%` : "0%");

/** 变化量:箭头 + 差值,中性色(变化不是好坏,不用红绿) */
function Delta({ from, to }: { from: number; to: number }) {
  if (from === to) return null;
  return (
    <span className="ml-1.5 text-2xs text-fg-2" aria-hidden="true">
      {to > from ? "↑" : "↓"}
      {Math.abs(Math.round((to - from) * 10) / 10)}
    </span>
  );
}

function Metric({ id, label, children }: { id: string; label: string; children: ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-3 border-b border-line px-4 py-2.5" data-testid={`sim-${id}`}>
      <span className="text-sm text-fg-2">{label}</span>
      <span className="num whitespace-nowrap text-sm font-medium">{children}</span>
    </div>
  );
}

function Pair({ from, to, unit = "" }: { from: number | string; to: number | string; unit?: string }) {
  return (
    <>
      <span className="text-fg-2">
        {from}
        {unit}
      </span>
      <span className="mx-1 text-fg-2">→</span>
      <span>
        {to}
        {unit}
      </span>
    </>
  );
}

/** 右侧影响预演面板(spec §5.3;R-7:桌面固定右侧)。只陈述"当前 → 草稿",不评判好坏。 */
export function SimulatePanel({
  impact,
  loading,
  error,
  dirty,
  baseLabel,
  canRun,
  onRun,
}: {
  impact: Impact | null;
  loading: boolean;
  error: string | null;
  dirty: boolean;
  baseLabel: string;
  canRun: boolean;
  onRun: () => void;
}) {
  return (
    <aside className="panel flex flex-col self-start" aria-label={S.simulate.title}>
      <div className="flex items-center gap-2 px-4 pb-2 pt-3">
        <h2 className="text-sm font-semibold">{S.simulate.title}</h2>
        <span className="text-2xs text-fg-2">{S.simulate.subtitle(baseLabel)}</span>
        <span className="flex-1" />
        {loading && <SpinnerIcon width={14} height={14} className="text-fg-2" />}
        {canRun && impact && (
          <button type="button" className="btn-ghost btn-sm" disabled={loading} onClick={onRun}>
            {S.simulate.rerun}
          </button>
        )}
      </div>
      {dirty && <p className="px-4 pb-2 text-2xs text-fg-2">{S.simulate.unsavedHint}</p>}
      {error && (
        <p role="alert" className="mx-4 mb-2 rounded-lg bg-bad-soft px-3 py-2 text-xs text-bad">
          {error}
        </p>
      )}
      {!impact ? (
        <p className="px-4 pb-5 pt-2 text-xs text-fg-2">{S.simulate.empty}</p>
      ) : (
        <div className="border-t border-line">
          <Metric id="gate" label={S.simulate.gate}>
            <Pair from={impact.gate.current} to={impact.gate.draft} />
            <Delta from={impact.gate.current} to={impact.gate.draft} />
          </Metric>
          <Metric id="clamped" label={S.simulate.clamped}>
            {S.simulate.people(impact.clamped)}
          </Metric>
          <Metric id="stage" label={S.simulate.stage}>
            <Pair from={impact.stageComplete.current} to={impact.stageComplete.draft} />
            <Delta from={impact.stageComplete.current} to={impact.stageComplete.draft} />
          </Metric>
          <Metric id="capped" label={S.simulate.capped}>
            <Pair from={percent(impact.dailyCap.cappedCurrent, impact.dailyCap.userDays)} to={percent(impact.dailyCap.cappedDraft, impact.dailyCap.userDays)} />
          </Metric>
          <Metric id="avg" label={S.simulate.avgPoints}>
            <Pair from={impact.dailyCap.avgPointsCurrent} to={impact.dailyCap.avgPointsDraft} />
            <Delta from={impact.dailyCap.avgPointsCurrent} to={impact.dailyCap.avgPointsDraft} />
          </Metric>
          <Metric id="pass-to-fail" label={S.simulate.passToFail}>
            {S.simulate.games(impact.verdicts.passToFail)}
          </Metric>
          <Metric id="fail-to-pass" label={S.simulate.failToPass}>
            {S.simulate.games(impact.verdicts.failToPass)}
          </Metric>
          <p className="px-4 pt-1.5 text-2xs text-fg-2">{S.simulate.ofMatches(impact.verdicts.matches)}</p>
          {(impact.verdicts.passToFail > 0 || impact.verdicts.failToPass > 0) && (
            <div className="mx-4 mt-2 flex items-center gap-2 rounded-lg bg-warn-soft px-3 py-2 text-xs text-fg" data-testid="sim-flip-note">
              <AlertIcon width={14} height={14} className="shrink-0 text-warn" />
              <span>{S.simulate.flipNote}</span>
            </div>
          )}
          <h3 className="px-4 pb-1 pt-3 text-2xs font-medium text-fg-2">{S.simulate.pool}</h3>
          <div className="grid grid-cols-6 gap-1 px-4" data-testid="sim-pool">
            {["1", "2", "3", "4", "5", "6"].map((t) => (
              <div key={t} className={`rounded-md px-1 py-1 text-center text-2xs ${impact.scenarioPool[t] < 2 ? "bg-bad-soft text-bad" : "bg-sunken text-fg-2"}`}>
                <div>{tierName(Number(t))}</div>
                <div className="num text-sm font-medium">{impact.scenarioPool[t] ?? 0}</div>
              </div>
            ))}
          </div>
          {impact.removedInUse && impact.removedInUse.length > 0 && (
            <p className="px-4 pt-2 text-2xs text-fg-2">{S.simulate.removedInUse(impact.removedInUse.join(", "))}</p>
          )}
          <h3 className="px-4 pb-1 pt-3 text-2xs font-medium text-fg-2">{S.simulate.pace}</h3>
          <ul className="space-y-0.5 px-4 pb-4 text-xs" data-testid="sim-pace">
            {TIER_KEYS.filter((k) => impact.paceDays[k]).map((k) => {
              const [lo, hi] = impact.paceDays[k];
              const cur = impact.paceDaysCurrent?.[k];
              return (
                <li key={k} className="flex justify-between">
                  <span className="text-fg-2">{tierName(k)}</span>
                  <span className="num">
                    {cur && (cur[0] !== lo || cur[1] !== hi) ? `${S.simulate.paceDays(cur[0], cur[1])} → ` : ""}
                    {S.simulate.paceDays(lo, hi)}
                  </span>
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </aside>
  );
}
