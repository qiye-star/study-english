import { useState } from "react";
import { Link } from "react-router-dom";
import { Avatar } from "../../components/avatar";
import { ConfirmDialog } from "../../components/confirm-dialog";
import { DataTable, type Column } from "../../components/data-table";
import { Page, Segmented } from "../../components/layout";
import { RoleGate } from "../../components/role-gate";
import { ErrorState, Skeleton } from "../../components/states";
import { useAsync } from "../../hooks/use-async";
import { formatDateTime } from "../../lib/format";
import { dismissAvatarReports, listAvatarReports, type AvatarReportRow, type AvatarReportStatus } from "./api";
import { RemoveAvatarDialog } from "./remove-avatar-dialog";
import { S } from "./strings";
import { AvatarThumb } from "./user-avatar-card";

const A = S.avatars;

/**
 * /avatar-reports:头像举报队列(viewer 可看,operator 可处理)。
 * 待处理按举报时间正序(最早在前),已处理按最近处理在前。移除头像需要理由 + 二次验证;忽略举报只需确认。
 */
export function AvatarReportsPage() {
  const [status, setStatus] = useState<AvatarReportStatus>("open");
  const [page, setPage] = useState(1);
  const [removing, setRemoving] = useState<{ userId: string; username: string } | null>(null);
  const [dismissing, setDismissing] = useState<AvatarReportRow | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const { data, error, reload } = useAsync(() => listAvatarReports(status, page), [status, page]);

  const columns: Column<AvatarReportRow>[] = [
    {
      key: "avatar",
      header: A.columns.avatar,
      render: (u) => (u.avatarUrl ? <AvatarThumb url={u.avatarUrl} size={40} /> : <Avatar name={u.username} size={40} />),
    },
    {
      key: "user",
      header: A.columns.user,
      className: "max-w-[260px]",
      render: (u) => (
        <span className="flex min-w-0 items-baseline gap-2">
          <Link className="truncate font-medium text-accent hover:underline" to={`/users/${encodeURIComponent(u.userId)}`}>
            {u.username}
          </Link>
          {u.nickname && <span className="truncate text-xs text-muted">{u.nickname}</span>}
        </span>
      ),
    },
    { key: "reports", header: A.columns.reports, numeric: true, render: (u) => <span className="num">{u.reports}</span> },
    { key: "reason", header: A.columns.reason, render: (u) => (u.lastReason ? A.reasons[u.lastReason] ?? u.lastReason : "—") },
    {
      key: "time",
      header: A.columns.time,
      render: (u) => <span className="num text-fg-2">{u.lastReportedAt ? formatDateTime(u.lastReportedAt) : "—"}</span>,
    },
    {
      key: "actions",
      header: A.columns.actions,
      align: "right",
      render: (u) => (
        <RoleGate min="operator">
          <span className="inline-flex justify-end gap-2">
            {u.avatarUrl && (
              <button type="button" className="btn-danger btn-sm" onClick={() => setRemoving({ userId: u.userId, username: u.username })}>
                {A.remove}
              </button>
            )}
            {status === "open" && (
              <button type="button" className="btn-ghost btn-sm" onClick={() => setDismissing(u)}>
                {A.dismiss}
              </button>
            )}
          </span>
        </RoleGate>
      ),
    },
  ];

  const changeStatus = (next: AvatarReportStatus) => {
    setStatus(next);
    setPage(1);
    setMessage(null);
  };

  return (
    <Page title={A.title}>
      <Segmented
        className="!w-auto"
        size="sm"
        label={A.status}
        value={status}
        onChange={changeStatus}
        options={(["open", "resolved"] as const).map((v) => ({ value: v, label: A.statuses[v] }))}
      />
      {message && (
        <p role="status" className="rounded-lg bg-good-soft px-3 py-2 text-sm text-good">
          {message}
        </p>
      )}
      {error ? (
        <ErrorState message={error} onRetry={reload} />
      ) : !data ? (
        <Skeleton rows={3} />
      ) : (
        <div className="panel">
          <DataTable columns={columns} rows={data.users} empty={A.empty[status]} rowKey={(u) => u.userId} caption={A.title} />
        </div>
      )}
      {data && (page > 1 || data.next) && (
        <div className="flex justify-end gap-2">
          <button type="button" className="btn-ghost btn-sm" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
            {A.prev}
          </button>
          <button type="button" className="btn-ghost btn-sm" disabled={!data.next} onClick={() => setPage((p) => p + 1)}>
            {A.next}
          </button>
        </div>
      )}
      <RemoveAvatarDialog
        target={removing}
        onClose={() => setRemoving(null)}
        onDone={(n) => {
          setRemoving(null);
          setMessage(A.done.removed(n));
          reload();
        }}
      />
      {dismissing && (
        <ConfirmDialog
          open
          title={A.dismissDialog.title}
          body={A.dismissDialog.body(dismissing.username)}
          onClose={() => setDismissing(null)}
          onConfirm={async () => {
            const r = await dismissAvatarReports(dismissing.userId);
            setDismissing(null);
            setMessage(A.done.dismissed(r.reportsResolved));
            reload();
          }}
        />
      )}
    </Page>
  );
}
