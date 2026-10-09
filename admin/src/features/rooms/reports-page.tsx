import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { DataTable, type Column } from "../../components/data-table";
import { Page, Segmented } from "../../components/layout";
import { ErrorState, Skeleton } from "../../components/states";
import { useAsync } from "../../hooks/use-async";
import { formatDateTime } from "../../lib/format";
import { listReports, type Report, type ReportStatus } from "./api";
import { ResolveDialog } from "./resolve-dialog";
import { S } from "./strings";

const R = S.reports;

/** /reports:举报队列(operator)。未处理按时间正序,已处理按处理时间倒序;处理时一键联动隐藏/移出/关闭。 */
export function ReportsPage() {
  const [status, setStatus] = useState<ReportStatus>("open");
  const [page, setPage] = useState(1);
  const [resolving, setResolving] = useState<Report | null>(null);
  useEffect(() => setPage(1), [status]);
  const { data, error, reload } = useAsync(() => listReports(status, page), [status, page]);

  const columns: Column<Report>[] = [
    {
      key: "message",
      header: R.message,
      className: "max-w-[420px]",
      render: (r) =>
        r.message ? (
          <span className="flex items-start gap-2">
            <span className="line-clamp-2 break-words">{r.message.text}</span>
            {r.message.hidden && <span className="badge shrink-0 bg-bad-soft text-bad">{R.hidden}</span>}
          </span>
        ) : (
          <span className="text-muted">{R.missing}</span>
        ),
    },
    { key: "sender", header: R.sender, render: (r) => r.message?.sender.name ?? S.timeline.unknownUser },
    { key: "reporter", header: R.reporter, render: (r) => r.reporter.name ?? S.timeline.unknownUser },
    { key: "reason", header: R.reason, render: (r) => R.reasons[r.reason] ?? r.reason },
    {
      key: "room",
      header: R.room,
      render: (r) => (
        <Link className="text-accent hover:underline" to={`/rooms/${encodeURIComponent(r.room.id)}`}>
          {r.room.name || r.room.topic || S.list.noTopic}
        </Link>
      ),
    },
    { key: "time", header: R.time, render: (r) => <span className="num text-fg-2">{formatDateTime(r.createdAt)}</span> },
    {
      key: "actions",
      header: R.actions,
      align: "right",
      render: (r) =>
        r.resolvedAt ? (
          <span className="text-xs text-fg-2">
            {R.resolutions[r.resolution ?? ""] ?? r.resolution}
            {r.resolvedBy && <span className="block text-muted">{R.resolvedBy(r.resolvedBy)}</span>}
          </span>
        ) : (
          <button type="button" className="btn-ghost btn-sm" onClick={() => setResolving(r)}>
            {R.resolve}
          </button>
        ),
    },
  ];

  return (
    <Page title={R.title}>
      <Segmented
        className="!w-auto"
        size="sm"
        label={R.status}
        value={status}
        onChange={setStatus}
        options={(["open", "resolved"] as const).map((v) => ({ value: v, label: R.statuses[v] }))}
      />
      {error ? (
        <ErrorState message={error} onRetry={reload} />
      ) : !data ? (
        <Skeleton rows={3} />
      ) : (
        <div className="panel">
          <DataTable columns={columns} rows={data.reports} empty={R.empty[status]} rowKey={(r) => r.id} caption={R.title} />
        </div>
      )}
      {data && (page > 1 || data.next) && (
        <div className="flex justify-end gap-2">
          <button type="button" className="btn-ghost btn-sm" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
            {R.prev}
          </button>
          <button type="button" className="btn-ghost btn-sm" disabled={!data.next} onClick={() => setPage((p) => p + 1)}>
            {R.next}
          </button>
        </div>
      )}
      <ResolveDialog
        report={resolving}
        onClose={() => setResolving(null)}
        onDone={() => {
          setResolving(null);
          reload();
        }}
      />
    </Page>
  );
}
