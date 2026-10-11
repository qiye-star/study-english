import { useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { DataTable, type Column } from "../../components/data-table";
import { Page } from "../../components/layout";
import { RoleGate } from "../../components/role-gate";
import { ErrorState, Skeleton } from "../../components/states";
import { StatusDot } from "../../components/status-dot";
import { errorText, useAsync } from "../../hooks/use-async";
import { formatDateTime } from "../../lib/format";
import { fetchLinks, resetBreaker, type LinkError, type LinkRow, type RankSourceRow } from "./api";
import { S } from "./strings";

const n = (v: number) => v.toLocaleString("en-US");
const pad = (v: number) => String(v).padStart(2, "0");
const clock = (d: Date) => `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;

function Kpi({ label, value, note, bad = false }: { label: string; value: ReactNode; note: ReactNode; bad?: boolean }) {
  return (
    <div className="panel space-y-1 px-4 py-3">
      <p className="text-xs font-medium text-fg-2">{label}</p>
      <div className={`num text-xl font-semibold leading-tight ${bad ? "text-bad" : ""}`}>{value}</div>
      <div className="truncate text-xs text-fg-2">{note}</div>
    </div>
  );
}

function BreakerCell({ row }: { row: LinkRow }) {
  if (row.breaker === "open")
    return <span className="badge bg-bad-soft text-bad">{S.breaker.open(n(row.openSeconds))}</span>;
  if (row.breaker === "half_open") return <StatusDot tone="warn" label={S.breaker.halfOpen} />;
  return <StatusDot tone="good" label={S.breaker.closed} />;
}

/** 计数格:没有事件订阅的联动显示「—」;失败 / 超时大于 0 用红字。 */
function counter(row: LinkRow, value: number, alarm = false): ReactNode {
  if (!row.subscribed) return <span className="text-muted">—</span>;
  return <span className={alarm && value > 0 ? "text-bad" : undefined}>{n(value)}</span>;
}

/** /links:学习联动的计数、熔断、关闭人数、段位来源与最近错误(learning links spec §9;桌面版式,视觉稿帧 07)。 */
export function LinksPage() {
  const view = useAsync(fetchLinks, []);
  const [loadedAt, setLoadedAt] = useState(() => new Date());
  const [busy, setBusy] = useState<string | null>(null);
  const [failure, setFailure] = useState<string | null>(null);

  const refresh = () => {
    setLoadedAt(new Date());
    view.reload();
  };

  const reset = async (key: string) => {
    setBusy(key);
    setFailure(null);
    try {
      await resetBreaker(key);
      refresh();
    } catch (e) {
      setFailure(S.resetFailed(errorText(e)));
    } finally {
      setBusy(null);
    }
  };

  const linkColumns: Column<LinkRow>[] = [
    {
      key: "link",
      header: S.cols.link,
      render: (r) => (
        <span className="block">
          <span className="block font-medium">{r.labelZh}</span>
          <span className="num block text-2xs text-muted">
            {r.key}
            {r.subscribed ? "" : ` · ${S.noSubscription}`}
          </span>
        </span>
      ),
    },
    {
      key: "global",
      header: S.cols.global,
      render: (r) =>
        r.global ? <span className="badge bg-good-soft text-good">{S.on}</span> : <span className="badge bg-sunken text-fg-2">{S.off}</span>,
    },
    {
      key: "effective",
      header: S.cols.effective,
      render: (r) => <StatusDot tone={r.effective ? "good" : "neutral"} label={r.effective ? S.effectiveYes : S.effectiveNo} />,
    },
    { key: "handled", header: S.cols.handled, numeric: true, render: (r) => counter(r, r.stats.handled) },
    { key: "skipped", header: S.cols.skipped, numeric: true, render: (r) => counter(r, r.stats.skipped) },
    { key: "failed", header: S.cols.failed, numeric: true, render: (r) => counter(r, r.stats.failed, true) },
    { key: "timeouts", header: S.cols.timeouts, numeric: true, render: (r) => counter(r, r.stats.timeouts, true) },
    { key: "dropped", header: S.cols.dropped, numeric: true, render: (r) => counter(r, r.stats.dropped) },
    { key: "breaker", header: S.cols.breaker, className: "whitespace-nowrap", render: (r) => <BreakerCell row={r} /> },
    { key: "usersOff", header: S.cols.usersOff, numeric: true, className: "whitespace-nowrap", render: (r) => S.usersOff(n(r.usersOff)) },
    {
      key: "actions",
      header: <span className="sr-only">{S.cols.actions}</span>,
      align: "right",
      render: (r) =>
        r.breaker === "closed" ? null : (
          <RoleGate min="operator">
            <button type="button" className="btn-ghost btn-sm whitespace-nowrap" disabled={busy !== null} onClick={() => void reset(r.key)}>
              {S.reset}
            </button>
          </RoleGate>
        ),
    },
  ];

  const sourceColumns: Column<RankSourceRow>[] = [
    { key: "kind", header: S.sourceCols.kind, render: (s) => <code className="num text-[12px]">{s.kind}</code> },
    { key: "label", header: S.sourceCols.label, render: (s) => s.labelZh },
    { key: "default", header: S.sourceCols.defaultPoints, numeric: true, render: (s) => n(s.defaultPoints) },
    { key: "points", header: S.sourceCols.points, numeric: true, render: (s) => n(s.points) },
  ];

  const data = view.data;
  const open = data ? data.links.filter((l) => l.breaker === "open") : [];

  return (
    <Page
      title={S.title}
      actions={
        <>
          <button type="button" className="btn-ghost btn-sm" onClick={refresh}>
            {S.refresh}
          </button>
          <Link className="btn-ghost btn-sm" to="/settings/links">
            {S.toSettings}
          </Link>
        </>
      }
    >
      {view.error ? (
        <ErrorState message={view.error} onRetry={refresh} />
      ) : !data ? (
        <Skeleton rows={6} />
      ) : (
        <>
          <div className="flex flex-wrap items-center gap-3 text-sm">
            {data.enabled ? (
              <span className="badge bg-good-soft text-good">{S.masterOn}</span>
            ) : (
              <span role="status" className="badge bg-warn-soft text-warn">{S.masterOff}</span>
            )}
            {!data.enabled && <span className="text-fg-2">{S.masterOffHint}</span>}
            <span className="flex-1" />
            <span className="text-xs text-muted">
              {S.processLocal} · <span className="num">{S.updatedAt(clock(loadedAt))}</span>
            </span>
          </div>
          {failure && (
            <p role="alert" className="text-sm text-bad">
              {failure}
            </p>
          )}
          <div className="grid grid-cols-4 gap-3">
            <Kpi label={S.kpis.queue} value={<>{n(data.queue.size)} <small className="text-sm font-normal text-fg-2">/ {n(data.queue.max)}</small></>} note={S.kpis.queueHint} />
            <Kpi label={S.kpis.dropped} value={n(data.queue.dropped)} note={S.kpis.droppedHint} bad={data.queue.dropped > 0} />
            <Kpi
              label={S.kpis.breakers}
              value={n(open.length)}
              bad={open.length > 0}
              note={open.length ? open.map((l) => S.kpis.openLeft(l.labelZh, n(l.openSeconds))).join(";") : S.kpis.breakersNone}
            />
            <Kpi label={S.kpis.errors} value={n(data.errors.length)} note={S.kpis.errorsHint} />
          </div>
          <div className="grid items-start gap-4 xl:grid-cols-[minmax(0,1fr)_340px]">
            <section className="panel" aria-label={S.linksTitle}>
              <div className="panel-head">
                <h2 className="text-sm font-semibold">{S.linksTitle}</h2>
                <span className="text-xs text-muted">{S.linksHint}</span>
              </div>
              <DataTable columns={linkColumns} rows={data.links} empty="—" rowKey={(r) => r.key} caption={S.linksTitle} />
            </section>
            <div className="flex flex-col gap-4">
              <section className="panel" aria-label={S.sourcesTitle}>
                <div className="panel-head">
                  <h2 className="text-sm font-semibold">{S.sourcesTitle}</h2>
                  <Link className="text-xs text-accent hover:underline" to="/rank/rules">
                    {S.sourcesLink}
                  </Link>
                </div>
                <DataTable columns={sourceColumns} rows={data.rankSources} empty={S.sourcesEmpty} rowKey={(s) => s.kind} caption={S.sourcesTitle} />
                <p className="px-4 pb-3 pt-2 text-xs leading-relaxed text-fg-2">{S.sourcesNote}</p>
              </section>
              <section className="panel" aria-label={S.errorsTitle}>
                <div className="panel-head">
                  <h2 className="text-sm font-semibold">{S.errorsTitle}</h2>
                  <span className="text-xs text-muted">{S.errorsHint}</span>
                </div>
                <ErrorList errors={data.errors} />
              </section>
            </div>
          </div>
        </>
      )}
    </Page>
  );
}

function ErrorList({ errors }: { errors: LinkError[] }) {
  if (errors.length === 0) return <p className="px-4 pb-4 pt-1 text-sm text-muted">{S.errorsEmpty}</p>;
  return (
    <ul className="max-h-[420px] overflow-y-auto divide-rows">
      {errors.map((e, i) => (
        <li key={`${e.at}-${i}`} className="flex items-baseline gap-3 px-4 py-2 text-sm">
          <span className="num shrink-0 text-xs text-muted">{formatDateTime(e.at)}</span>
          <span className="num min-w-0 break-words text-[12px]">
            {e.link} · {e.event} · {e.error}
          </span>
        </li>
      ))}
    </ul>
  );
}
