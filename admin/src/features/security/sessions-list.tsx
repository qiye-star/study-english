import { useState } from "react";
import { ConfirmDialog } from "../../components/confirm-dialog";
import { DataTable, type Column } from "../../components/data-table";
import { ErrorState, Skeleton } from "../../components/states";
import { useAsync } from "../../hooks/use-async";
import { formatDateTime, formatRelative } from "../../lib/format";
import { listSessions, revokeSession, type AdminSessionRow } from "./api";
import { S } from "./strings";

/** "我的会话"(所有角色);超级管理员可切换为全部管理员的会话(撤销他人会话需二次验证)。 */
export function SessionsList({ canSeeAll, onRevokedCurrent }: { canSeeAll: boolean; onRevokedCurrent: () => void }) {
  const [all, setAll] = useState(false);
  const [tick, setTick] = useState(0);
  const sessions = useAsync(() => listSessions(all), [all, tick]);
  const [target, setTarget] = useState<AdminSessionRow | null>(null);

  const revoke = async () => {
    if (!target) return;
    await revokeSession(target.id);
    const wasCurrent = target.current;
    setTarget(null);
    if (wasCurrent) onRevokedCurrent();
    else setTick((t) => t + 1);
  };

  const columns: Column<AdminSessionRow>[] = [
    ...(all ? [{ key: "user", header: S.sessionCols.user, render: (r: AdminSessionRow) => <span className="font-mono">{r.username}</span> }] : []),
    {
      key: "device",
      header: S.sessionCols.device,
      render: (r) => (
        <span className="inline-flex items-center gap-2">
          <span className="max-w-[360px] truncate text-fg-2" title={r.userAgent}>
            {r.userAgent || "—"}
          </span>
          {r.current && <span className="badge bg-accent-soft text-accent-strong">{S.current}</span>}
        </span>
      ),
    },
    { key: "ip", header: S.sessionCols.ip, render: (r) => <span className="num">{r.ip}</span> },
    { key: "seen", header: S.sessionCols.lastSeen, render: (r) => <span className="num text-fg-2">{formatRelative(r.lastSeenAt)}</span> },
    { key: "created", header: S.sessionCols.created, render: (r) => <span className="num text-fg-2">{formatDateTime(r.createdAt)}</span> },
    {
      key: "actions",
      header: S.sessionCols.actions,
      align: "right",
      render: (r) => (
        <button type="button" className="btn-ghost btn-sm" onClick={() => setTarget(r)}>
          {S.revoke}
        </button>
      ),
    },
  ];

  return (
    <section aria-label={all ? S.allSessions : S.mySessions} className="panel">
      <div className="panel-head">
        <h2 className="text-md font-semibold">{all ? S.allSessions : S.mySessions}</h2>
        {canSeeAll && (
          <label className="inline-flex items-center gap-2 text-xs text-fg-2">
            <input type="checkbox" checked={all} onChange={(e) => setAll(e.target.checked)} />
            {S.showAll}
          </label>
        )}
      </div>
      <div className="px-1 pb-2">
        {sessions.error ? (
          <ErrorState message={sessions.error} onRetry={sessions.reload} />
        ) : !sessions.data ? (
          <Skeleton rows={2} />
        ) : (
          <DataTable columns={columns} rows={sessions.data} rowKey={(r) => r.id} empty={S.noSessions} caption={S.mySessions} />
        )}
      </div>
      <ConfirmDialog
        open={target !== null}
        title={S.revokeTitle}
        body={target?.current ? S.revokeCurrentBody : S.revokeBody}
        danger
        confirmText={S.revoke}
        onConfirm={revoke}
        onClose={() => setTarget(null)}
      />
    </section>
  );
}
