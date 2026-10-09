import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { ConfirmDialog } from "../../components/confirm-dialog";
import { DataTable } from "../../components/data-table";
import { Page } from "../../components/layout";
import { RoleGate } from "../../components/role-gate";
import { ErrorState, Skeleton } from "../../components/states";
import { useAsync } from "../../hooks/use-async";
import { formatDateTime } from "../../lib/format";
import * as api from "./api";
import type { MatchRow } from "./api";
import { MatchStatusBadge } from "./match-status";
import { MATCH_STATUS, S, tierName } from "./strings";
import { TierIcon } from "./tier-icons";

type Pending = "cooldowns" | "reset" | "undo" | null;

function Stat({ label, value }: { label: string; value: number | string }) {
  return (
    <div className="panel px-4 py-3">
      <div className="text-xs text-fg-2">{label}</div>
      <div className="num mt-1 text-xl font-semibold">{value}</div>
    </div>
  );
}

/** /rank:段位分布、近 7 天比赛、进行中/冷却人数、全体操作(spec §5.6)。 */
export function RankOverviewPage() {
  const overview = useAsync(() => api.getRankOverview(), []);
  const matches = useAsync(() => api.listMatches({ page: 1 }), []);
  const [pending, setPending] = useState<Pending>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const navigate = useNavigate();
  const data = overview.data;

  const done = (n: number) => {
    setPending(null);
    setNotice(S.overview.done(n));
    overview.reload();
    matches.reload();
  };

  const max = Math.max(1, ...(data?.tiers.map((t) => t.users) ?? [1]));

  return (
    <Page
      title={S.rankPage}
      actions={
        <>
          <Link to="/rank/rules" className="btn-ghost btn-sm">
            {S.overview.rulesLink}
          </Link>
          <RoleGate min="operator">
            <button type="button" className="btn-ghost btn-sm" disabled={!data} onClick={() => setPending("cooldowns")}>
              {S.overview.clearCooldowns}
            </button>
          </RoleGate>
          <RoleGate min="superadmin">
            {data?.lastReset && (
              <button type="button" className="btn-ghost btn-sm" onClick={() => setPending("undo")}>
                {S.overview.undo}
              </button>
            )}
            <button type="button" className="btn-danger btn-sm" disabled={!data} onClick={() => setPending("reset")}>
              {S.overview.resetAll}
            </button>
          </RoleGate>
        </>
      }
    >
      {notice && (
        <p role="status" className="rounded-lg bg-good-soft px-3 py-2 text-sm">
          {notice}
        </p>
      )}
      {overview.loading && !data ? (
        <Skeleton variant="blocks" rows={2} />
      ) : overview.error || !data ? (
        <ErrorState message={overview.error ?? "—"} onRetry={overview.reload} />
      ) : (
        <>
          <div className="grid grid-cols-4 gap-3">
            <Stat label={S.overview.active} value={data.activeMatches} />
            <Stat label={S.overview.cooldown} value={data.cooldownUsers} />
            <Stat label={`${S.overview.matches7d} · ${MATCH_STATUS.passed}`} value={data.matches7d.passed} />
            <Stat label={`${S.overview.matches7d} · ${MATCH_STATUS.failed}`} value={data.matches7d.failed} />
          </div>
          <section className="panel px-4 py-3">
            <h2 className="mb-2 text-sm font-semibold">{S.overview.distribution}</h2>
            <ul className="space-y-1.5">
              {data.tiers.map((t) => (
                <li key={t.key} className="grid grid-cols-[96px_1fr_64px] items-center gap-3 text-sm">
                  <span className="flex items-center gap-1.5">
                    <TierIcon tier={t.key} width={16} height={16} className="text-fg-2" />
                    {tierName(t.key)}
                  </span>
                  <span className="h-2 overflow-hidden rounded-full bg-sunken" aria-hidden="true">
                    <span className="block h-full rounded-full bg-accent" style={{ width: `${(t.users / max) * 100}%` }} />
                  </span>
                  <span className="num text-right text-fg-2">{S.overview.users(t.users)}</span>
                </li>
              ))}
            </ul>
            <p className="mt-2 text-2xs text-fg-2">
              {MATCH_STATUS.grading_failed} {data.matches7d.gradingFailed} · {MATCH_STATUS.voided} {data.matches7d.voided}
            </p>
          </section>
        </>
      )}
      <section className="panel">
        <div className="panel-head">
          <h2 className="text-sm font-semibold">{S.overview.recent}</h2>
        </div>
        <DataTable<MatchRow>
          rows={matches.data?.items ?? []}
          rowKey={(m) => m.id}
          empty={matches.loading ? "…" : "—"}
          onRowClick={(m) => navigate(`/rank/matches/${encodeURIComponent(m.id)}`)}
          columns={[
            { key: "time", header: S.panel.time, render: (m) => <span className="num">{formatDateTime(m.startedAt)}</span> },
            { key: "user", header: "#", render: (m) => <span className="num text-fg-2">{m.userId}</span> },
            { key: "target", header: S.panel.target, render: (m) => tierName(m.toTier) },
            { key: "scenario", header: S.panel.scenario, render: (m) => m.scenarioTitleZh },
            { key: "status", header: S.panel.status, render: (m) => <MatchStatusBadge match={m} /> },
            { key: "score", header: S.panel.score, numeric: true, render: (m) => `${m.total ?? "—"} / ${m.threshold}` },
            { key: "rules", header: S.panel.rules, render: (m) => <span className="font-mono text-xs">{m.rulesVersion === null ? "v0" : `v${m.rulesVersion}`}</span> },
          ]}
        />
      </section>
      <ConfirmDialog
        open={pending === "cooldowns"}
        title={S.overview.clearCooldowns}
        body={S.overview.clearCooldownsBody}
        reasonRequired
        onConfirm={async (reason) => done((await api.clearAllCooldowns(reason))?.users ?? 0)}
        onClose={() => setPending(null)}
      />
      <ConfirmDialog
        open={pending === "reset"}
        title={S.overview.resetAll}
        body={S.overview.resetAllBody}
        requireTyping={data?.resetConfirm}
        reasonRequired
        danger
        onConfirm={async (reason) => done((await api.resetAll(reason, data?.resetConfirm ?? ""))?.users ?? 0)}
        onClose={() => setPending(null)}
      />
      {data?.lastReset && (
        <ConfirmDialog
          open={pending === "undo"}
          title={S.overview.undo}
          body={S.overview.undoBody(data.lastReset.users, formatDateTime(data.lastReset.undoUntil))}
          onConfirm={async () => done((await api.undoReset(data.lastReset!.batchId))?.users ?? 0)}
          onClose={() => setPending(null)}
        />
      )}
    </Page>
  );
}
