import { useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { ConfirmDialog } from "../../components/confirm-dialog";
import { DataTable, type Column } from "../../components/data-table";
import { Chips, Page } from "../../components/layout";
import { RoleGate } from "../../components/role-gate";
import { ErrorState, LoadMore, Skeleton } from "../../components/states";
import { StatusDot, type Tone } from "../../components/status-dot";
import { useAsync } from "../../hooks/use-async";
import { usePaged } from "../../hooks/use-paged";
import { formatBytes, formatDateTime, formatDuration } from "../../lib/format";
import {
  CANCELLABLE,
  LIBRARY_STATUSES,
  cancelLibraryItem,
  deleteLibraryItem,
  deletePhrase,
  fetchLibraryItems,
  fetchLibraryOverview,
  fetchTopUsers,
  purgeFailedItems,
  type KindFilter,
  type LibraryOverview,
  type LibraryRow,
  type LibraryTopUser,
  type StatusFilter,
} from "./api";
import { S } from "./strings";

const n = (v: number) => v.toLocaleString("en-US");

type Pending = { kind: "delete" | "cancel"; row: LibraryRow } | { kind: "purge"; phrase: string; count: number };

function Summary({ o }: { o: LibraryOverview }) {
  const state: [Tone, string] = !o.enabled ? ["neutral", S.state.off] : o.available ? ["good", S.state.on] : ["bad", S.state.unavailable];
  const asr: [Tone, string] = !o.asr.enabled
    ? ["neutral", S.asr.off]
    : [o.asr.available ? "good" : "warn", S.asr.on(n(o.asr.todayMinutes), n(o.asr.globalDailyMinutes))];
  const link: [Tone, string] = !o.link.enabled ? ["neutral", S.link.off] : o.link.available ? ["good", S.link.on] : ["warn", S.link.unavailable];
  const ai: [Tone, string] = !o.ai.enabled
    ? ["neutral", S.ai.off]
    : o.ai.available
      ? ["good", S.ai.on(n(o.ai.todayTranslated), n(o.ai.todayAnalysed), n(o.ai.globalDaily))]
      : ["warn", S.ai.unavailable];
  return (
    <div className="panel space-y-2 px-4 py-3 text-sm">
      <div className="flex flex-wrap items-center gap-x-6 gap-y-2">
        <StatusDot tone={state[0]} label={state[1]} />
        <StatusDot tone={asr[0]} label={asr[1]} />
        {o.asr.enabled && !o.asr.available && <span className="text-warn">{S.asr.unavailable}</span>}
        <StatusDot tone={link[0]} label={link[1]} />
        <StatusDot tone={ai[0]} label={ai[1]} />
        <Link className="ml-auto text-accent hover:underline" to="/settings/library">
          {S.toSettings}
        </Link>
      </div>
      <p className="text-fg-2">
        {S.link.cookies(o.link.cookiesConfigured)} · {S.link.proxy(o.link.proxyConfigured)}
        {o.link.allowGeneric && (
          <>
            {" · "}
            <span className="text-warn">{S.link.generic}</span>
          </>
        )}
        {" · "}
        <span className="num">{S.tools(o.tools.ffmpeg, o.tools.ytdlp)}</span>
      </p>
      <p className="num text-fg-2">
        {S.limits(n(o.limits.quotaMb), n(o.limits.maxItems), n(o.limits.maxUploadMb), n(o.limits.maxDurationMinutes))}
      </p>
      {o.ai.enabled && (
        <p className="num text-fg-2">{S.ai.perUser(n(o.ai.translateDailyPerUser), n(o.ai.analysisDailyPerUser))}</p>
      )}
      {!o.enabled && <p className="text-fg-2">{S.off}</p>}
      <p className="text-2xs text-muted">{S.privacy}</p>
    </div>
  );
}

function Kpis({ o }: { o: LibraryOverview }) {
  const cells: [string, string][] = [
    [S.kpi.items, n(o.totals.items)],
    [S.kpi.bytes, formatBytes(o.totals.bytes)],
    [S.kpi.users, n(o.totals.users)],
    [S.kpi.queue, `${n(o.queue.queued)} / ${n(o.queue.processing)} / ${n(o.queue.running)}`],
  ];
  return (
    <dl className="panel grid grid-cols-4 gap-px overflow-hidden bg-line">
      {cells.map(([label, value]) => (
        <div key={label} className="bg-surface px-4 py-3">
          <dt className="text-2xs text-fg-2">{label}</dt>
          <dd className="num mt-1 text-md font-semibold">{value}</dd>
        </div>
      ))}
    </dl>
  );
}

function StatusCell({ row }: { row: LibraryRow }) {
  const tone: Tone = row.status === "ready" ? "good" : row.status === "failed" ? "bad" : row.status === "canceled" ? "neutral" : "warn";
  return (
    <span className="block space-y-0.5">
      <StatusDot tone={tone} label={S.status[row.status] ?? row.status} />
      {row.status === "processing" && row.stage && (
        <span className="num block text-2xs text-muted">{S.progress(S.stage[row.stage] ?? row.stage, String(row.progress))}</span>
      )}
      {row.status === "failed" && row.errorKind && <span className="block text-2xs text-bad">{S.errors[row.errorKind] ?? row.errorKind}</span>}
    </span>
  );
}

const userLink = (userId: number, username: string | null) => (
  <Link className="font-medium text-accent hover:underline" to={`/users/${userId}`}>
    {username ?? String(userId)}
  </Link>
);

const TOP_COLUMNS: Column<LibraryTopUser>[] = [
  { key: "user", header: S.topCols.user, render: (u) => userLink(u.userId, u.username) },
  { key: "items", header: S.topCols.items, numeric: true, render: (u) => n(u.items) },
  { key: "bytes", header: S.topCols.bytes, numeric: true, render: (u) => formatBytes(u.bytes) },
];

/** /library:跟读库总览、占用排行、条目表(spec 2026-10-13-video-import §12;桌面版式 R-7)。没有任何标题或网址(E10)。 */
export function LibraryPage() {
  const [params, setParams] = useSearchParams();
  const rawUser = params.get("user");
  const userId = rawUser && /^\d{1,10}$/.test(rawUser) ? rawUser : null;
  const [status, setStatus] = useState<StatusFilter>("all");
  const [kind, setKind] = useState<KindFilter>("all");
  const [pending, setPending] = useState<Pending | null>(null);
  const overview = useAsync(fetchLibraryOverview, []);
  const top = useAsync(fetchTopUsers, []);
  const paged = usePaged<LibraryRow>((page) => fetchLibraryItems({ status, kind, userId }, page), [status, kind, userId]);

  const reloadAll = () => {
    overview.reload();
    top.reload();
    paged.reload();
  };

  const confirm = async (reason: string) => {
    if (!pending) return;
    if (pending.kind === "delete") await deleteLibraryItem(pending.row.id, reason, deletePhrase(pending.row.id));
    else if (pending.kind === "cancel") await cancelLibraryItem(pending.row.id, reason);
    else if (pending.kind === "purge") await purgeFailedItems(reason, pending.phrase);
    setPending(null);
    reloadAll();
  };

  const clearUser = () =>
    setParams(
      (p) => {
        const next = new URLSearchParams(p);
        next.delete("user");
        return next;
      },
      { replace: true },
    );

  const columns: Column<LibraryRow>[] = [
    { key: "user", header: S.cols.user, render: (r) => userLink(r.userId, r.username) },
    { key: "kind", header: S.cols.kind, render: (r) => S.kind[r.kind] ?? r.kind },
    {
      key: "source",
      header: S.cols.source,
      render: (r) => (
        <span className="block">
          {S.source[r.source] ?? r.source}
          {r.sourceHost && <span className="block text-2xs text-muted">{r.sourceHost}</span>}
        </span>
      ),
    },
    { key: "status", header: S.cols.status, render: (r) => <StatusCell row={r} /> },
    { key: "duration", header: S.cols.duration, numeric: true, render: (r) => (r.durationMs === null ? "—" : formatDuration(r.durationMs)) },
    { key: "bytes", header: S.cols.bytes, numeric: true, render: (r) => formatBytes(r.bytes) },
    { key: "subs", header: S.cols.subs, render: (r) => (r.subSource ? S.subs[r.subSource] ?? r.subSource : "—") },
    { key: "created", header: S.cols.created, render: (r) => <span className="num text-fg-2">{formatDateTime(r.createdAt)}</span> },
    {
      key: "actions",
      header: S.cols.actions,
      align: "right",
      render: (r) => (
        <RoleGate min="operator">
          <span className="inline-flex gap-1">
            {CANCELLABLE.includes(r.status) && (
              <button type="button" className="btn-ghost btn-sm" onClick={() => setPending({ kind: "cancel", row: r })}>
                {S.cancel}
              </button>
            )}
            <button type="button" className="btn-ghost btn-sm text-bad" onClick={() => setPending({ kind: "delete", row: r })}>
              {S.delete}
            </button>
          </span>
        </RoleGate>
      ),
    },
  ];

  const failed = overview.data?.byStatus.failed ?? 0;
  const dialog =
    pending?.kind === "delete"
      ? { title: S.deleteTitle, body: S.deleteBody, danger: true, typing: deletePhrase(pending.row.id) as string | undefined }
      : pending?.kind === "cancel"
        ? { title: S.cancelTitle, body: S.cancelBody, danger: false, typing: undefined }
        : pending?.kind === "purge"
          ? { title: S.purgeTitle, body: S.purgeBody(n(pending.count)), danger: true, typing: pending.phrase }
          : { title: "", body: "", danger: false, typing: undefined };

  return (
    <Page
      title={S.title}
      actions={
        <RoleGate min="operator">
          <button
            type="button"
            className="btn-ghost btn-sm"
            disabled={!overview.data || failed === 0}
            onClick={() => overview.data && setPending({ kind: "purge", phrase: overview.data.purgeConfirm, count: failed })}
          >
            {S.purge}
          </button>
        </RoleGate>
      }
    >
      {overview.error ? (
        <ErrorState message={overview.error} onRetry={overview.reload} />
      ) : !overview.data ? (
        <Skeleton rows={3} />
      ) : (
        <>
          <Summary o={overview.data} />
          <Kpis o={overview.data} />
        </>
      )}

      <h2 className="pt-2 text-sm font-semibold">{S.topUsers}</h2>
      {top.error ? (
        <ErrorState message={top.error} onRetry={top.reload} />
      ) : !top.data ? (
        <Skeleton rows={2} />
      ) : (
        <div className="panel">
          <DataTable columns={TOP_COLUMNS} rows={top.data.users} empty={S.topEmpty} rowKey={(u) => u.userId} caption={S.topUsers} />
        </div>
      )}

      <h2 className="pt-2 text-sm font-semibold">{S.items}</h2>
      <div className="flex flex-wrap items-center gap-3">
        <Chips
          label={S.filters.status}
          value={status}
          onChange={setStatus}
          options={[{ value: "all" as StatusFilter, label: S.filters.all }, ...LIBRARY_STATUSES.map((s) => ({ value: s as StatusFilter, label: S.status[s] }))]}
        />
        <Chips
          label={S.filters.kind}
          value={kind}
          onChange={setKind}
          options={[
            { value: "all" as KindFilter, label: S.filters.all },
            { value: "audio" as KindFilter, label: S.kind.audio },
            { value: "video" as KindFilter, label: S.kind.video },
          ]}
        />
        {userId && (
          <button type="button" className="btn-ghost btn-sm" aria-label={S.clearUser} onClick={clearUser}>
            {S.userFilter(userId)} ×
          </button>
        )}
      </div>
      {paged.loading ? (
        <Skeleton rows={4} />
      ) : paged.error ? (
        <ErrorState message={paged.error} onRetry={paged.reload} />
      ) : (
        <div className="panel">
          <DataTable columns={columns} rows={paged.items} empty={S.itemsEmpty} rowKey={(r) => r.id} caption={S.items} />
        </div>
      )}
      <LoadMore paged={paged} />

      <ConfirmDialog
        open={pending !== null}
        title={dialog.title}
        body={dialog.body}
        danger={dialog.danger}
        requireTyping={dialog.typing}
        reasonRequired
        onConfirm={confirm}
        onClose={() => setPending(null)}
      />
    </Page>
  );
}
