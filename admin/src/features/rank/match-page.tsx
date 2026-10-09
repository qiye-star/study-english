import { useCallback, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { ConfirmDialog } from "../../components/confirm-dialog";
import { AlertIcon } from "../../components/icons";
import { Page } from "../../components/layout";
import { RoleGate } from "../../components/role-gate";
import { ErrorState, Skeleton } from "../../components/states";
import { useAsync } from "../../hooks/use-async";
import { formatDateTime } from "../../lib/format";
import * as api from "./api";
import { MatchStatusBadge, VOIDABLE } from "./match-status";
import { MatchTurns } from "./match-turns";
import { DIMENSIONS, GATES, S, tierName } from "./strings";

function DimensionBar({ label, value, max }: { label: string; value: number | null | undefined; max: number }) {
  const width = value === null || value === undefined ? 0 : Math.min(100, (value / max) * 100);
  return (
    <div className="grid grid-cols-[88px_1fr_48px] items-center gap-3 text-sm">
      <span className="text-fg-2">{label}</span>
      <span className="h-1.5 overflow-hidden rounded-full bg-sunken" aria-hidden="true">
        <span className="block h-full rounded-full bg-accent" style={{ width: `${width}%` }} />
      </span>
      <span className="num text-right">{value ?? "—"}</span>
    </div>
  );
}

/** /rank/matches/:id:比赛审计(简报、逐轮转写与分数、评委结果、规则版本;视觉稿第 3 屏)。服务端写查看审计。 */
export function MatchPage() {
  const { id = "" } = useParams();
  const state = useAsync(() => api.getMatch(id), [id]);
  const [pending, setPending] = useState<"void" | "regrade" | null>(null);
  const close = useCallback(() => setPending(null), []);
  const data = state.data;

  if (state.loading && !data) {
    return (
      <Page title={S.matchPage}>
        <Skeleton variant="blocks" rows={3} />
      </Page>
    );
  }
  if (state.error || !data) {
    return (
      <Page title={S.matchPage}>
        <ErrorState message={state.error ?? "—"} onRetry={state.reload} />
      </Page>
    );
  }
  const { match, scenario, result } = data;
  const met = new Set(result?.functionsMet ?? []);
  const done = () => {
    setPending(null);
    state.reload();
  };

  return (
    <Page
      title={`${S.matchPage} · ${scenario.titleZh}`}
      actions={
        <RoleGate min="operator">
          {VOIDABLE.has(match.status) && (
            <button type="button" className="btn-ghost btn-sm" onClick={() => setPending("void")}>
              {S.panel.void}
            </button>
          )}
          {match.status === "grading_failed" && (
            <button type="button" className="btn-ghost btn-sm" onClick={() => setPending("regrade")}>
              {S.panel.regrade}
            </button>
          )}
        </RoleGate>
      }
    >
      <p className="flex items-center gap-2 rounded-lg bg-warn-soft px-3 py-2 text-sm text-fg">
        <AlertIcon width={16} height={16} className="shrink-0 text-warn" />
        {S.match.warning}
      </p>
      <div className="panel flex flex-wrap items-center gap-x-6 gap-y-2 px-4 py-3 text-sm">
        <Link to={`/users/${data.userId}`} className="text-accent hover:underline">
          {S.match.user(data.userId)}
        </Link>
        <span>
          {tierName(match.fromTier)} → {tierName(match.toTier)}
        </span>
        <MatchStatusBadge match={match} />
        <span className="num">
          {S.match.total} {match.total ?? "—"} / {S.match.threshold} {match.threshold}
        </span>
        <span className="num text-fg-2">{formatDateTime(match.startedAt)}</span>
        <Link to="/rank/rules" className="font-mono text-xs text-accent hover:underline">
          {S.match.rulesVersion(match.rulesVersion)}
        </Link>
      </div>
      <div className="grid grid-cols-[minmax(0,1fr)_360px] items-start gap-4">
        <div className="space-y-4">
          <section className="panel px-4 py-3">
            <h2 className="mb-1 text-sm font-semibold">{S.match.brief}</h2>
            <p className="text-sm">
              {scenario.titleZh} <span className="text-fg-2">· {scenario.titleEn}</span>
            </p>
            {scenario.briefZh && <p className="mt-1 text-sm text-fg-2">{scenario.briefZh}</p>}
            <h3 className="mb-1 mt-3 text-xs font-medium text-fg-2">{S.match.goals}</h3>
            <ul className="space-y-0.5 text-sm">
              {scenario.functions.map((f) => (
                <li key={f} className={met.has(f) ? "text-fg" : "text-fg-2"}>
                  {met.has(f) ? "✓ " : "· "}
                  {f}
                </li>
              ))}
            </ul>
          </section>
          <section className="panel px-4 py-3">
            <h2 className="mb-2 text-sm font-semibold">{S.match.turns}</h2>
            <MatchTurns turns={match.turns} />
          </section>
        </div>
        <section className="panel space-y-3 px-4 py-3">
          <h2 className="text-sm font-semibold">{S.match.verdict}</h2>
          {!result ? (
            <p className="text-sm text-fg-2">{S.match.noResult}</p>
          ) : (
            <>
              <div className="space-y-1.5">
                {(["task", "accuracy", "range", "interaction"] as const).map((k) => (
                  <DimensionBar key={k} label={DIMENSIONS[k]} value={result.dimensions?.[k]} max={4} />
                ))}
                <DimensionBar label={DIMENSIONS.speech} value={result.dimensions?.speech} max={100} />
              </div>
              {(result.gatesFailed?.length ?? 0) > 0 && (
                <div>
                  <h3 className="mb-1 text-xs font-medium text-fg-2">{S.match.gates}</h3>
                  <ul className="space-y-0.5 text-sm">
                    {result.gatesFailed!.map((g) => (
                      <li key={g}>{GATES[g] ?? g}</li>
                    ))}
                  </ul>
                </div>
              )}
              {(result.strengthsZh?.length ?? 0) > 0 && (
                <div>
                  <h3 className="mb-1 text-xs font-medium text-fg-2">{S.match.strengths}</h3>
                  <ul className="list-inside list-disc text-sm">
                    {result.strengthsZh!.map((t) => (
                      <li key={t}>{t}</li>
                    ))}
                  </ul>
                </div>
              )}
              {(result.improveZh?.length ?? 0) > 0 && (
                <div>
                  <h3 className="mb-1 text-xs font-medium text-fg-2">{S.match.improve}</h3>
                  <ul className="list-inside list-disc text-sm">
                    {result.improveZh!.map((t) => (
                      <li key={t}>{t}</li>
                    ))}
                  </ul>
                </div>
              )}
              {result.drillEn && (
                <div>
                  <h3 className="mb-1 text-xs font-medium text-fg-2">{S.match.drill}</h3>
                  <p className="text-sm">{result.drillEn}</p>
                </div>
              )}
            </>
          )}
        </section>
      </div>
      <ConfirmDialog
        open={pending === "void"}
        title={S.panel.voidTitle}
        body={S.panel.voidBody}
        reasonRequired
        onConfirm={async (reason) => {
          await api.voidMatch(match.id, reason);
          done();
        }}
        onClose={close}
      />
      <ConfirmDialog
        open={pending === "regrade"}
        title={S.panel.regradeTitle}
        body={S.panel.regradeBody}
        onConfirm={async () => {
          await api.regradeMatch(match.id);
          done();
        }}
        onClose={close}
      />
    </Page>
  );
}
