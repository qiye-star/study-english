import { useState } from "react";
import { ConfirmDialog } from "../../components/confirm-dialog";
import { DataTable } from "../../components/data-table";
import { ErrorState, Skeleton } from "../../components/states";
import { errorText, useAsync } from "../../hooks/use-async";
import { formatBytes, formatDateTime } from "../../lib/format";
import { backupLink, createBackup, deleteBackup, listBackups, type Backup } from "./api";
import { startDownload } from "./download";
import { S } from "./strings";

const D = S.data;

/** SQLite 备份表:立即备份、下载、删除;Postgres 时只显示 pg_dump 说明。 */
export function BackupsTable() {
  const state = useAsync(() => Promise.resolve(listBackups()), []);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<Backup | null>(null);

  const run = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  };

  const data = state.data;
  return (
    <section className="panel" aria-label={D.backups}>
      <div className="panel-head">
        <h2 className="text-sm font-semibold text-fg-2">{D.backups}</h2>
        {data?.supported && (
          <button type="button" className="btn-primary btn-sm" disabled={busy} onClick={() => void run(async () => (await createBackup(), state.reload()))}>
            {D.backupNow}
          </button>
        )}
      </div>
      <div className="space-y-2 px-4 pb-3">
        {state.loading && !data ? (
          <Skeleton rows={2} />
        ) : state.error ? (
          <ErrorState message={state.error} onRetry={state.reload} />
        ) : data && !data.supported ? (
          <div className="space-y-1 rounded-lg bg-sunken px-3 py-2 text-sm">
            <p className="font-medium">{D.pgTitle}</p>
            {data.hint && <p className="font-mono text-xs text-fg-2">{data.hint}</p>}
          </div>
        ) : data ? (
          <>
            <p className="text-xs text-fg-2">{D.keepNote(data.keep, data.hourUtc)}</p>
            <DataTable
              caption={D.backups}
              rows={data.backups}
              rowKey={(b) => b.name}
              empty={D.emptyBackups}
              columns={[
                { key: "name", header: D.name, render: (b) => <span className="font-mono text-xs">{b.name}</span> },
                { key: "size", header: D.size, numeric: true, render: (b) => formatBytes(b.bytes) },
                { key: "time", header: D.time, render: (b) => <span className="num text-xs">{formatDateTime(b.createdAt)}</span> },
                {
                  key: "actions",
                  header: "",
                  align: "right",
                  render: (b) => (
                    <span className="inline-flex gap-1">
                      <button type="button" className="btn-quiet btn-sm" disabled={busy} onClick={() => void run(async () => startDownload(await backupLink(b.name)))}>
                        {D.download}
                      </button>
                      <button type="button" className="btn-quiet btn-sm text-bad" disabled={busy} onClick={() => setDeleting(b)}>
                        {D.delete}
                      </button>
                    </span>
                  ),
                },
              ]}
            />
          </>
        ) : null}
        {error && (
          <p role="alert" className="text-sm text-bad">
            {error}
          </p>
        )}
      </div>
      <ConfirmDialog
        open={deleting !== null}
        title={D.deleteTitle}
        body={deleting ? D.deleteBody(deleting.name) : undefined}
        confirmText={D.delete}
        danger
        onConfirm={async () => {
          if (deleting) await deleteBackup(deleting.name);
          setDeleting(null);
          state.reload();
        }}
        onClose={() => setDeleting(null)}
      />
    </section>
  );
}
