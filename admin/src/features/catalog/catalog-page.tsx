import { useEffect, useState } from "react";
import { hasRole, useAdminSession } from "../../api/session";
import { DataTable, type Column } from "../../components/data-table";
import { Page } from "../../components/layout";
import { RoleGate } from "../../components/role-gate";
import { ErrorState, Skeleton } from "../../components/states";
import { StatusDot, type Tone } from "../../components/status-dot";
import { errorText as apiErrorText, useAsync } from "../../hooks/use-async";
import { formatDuration } from "../../lib/format";
import { ACTIVE, fetchCatalog, publish, unpublish, type CatalogRow, type CatalogState } from "./api";
import { CatalogDetail } from "./catalog-detail";
import { ImportDialog } from "./import-dialog";
import { S, errorText } from "./strings";
import { UploadDialog } from "./upload-dialog";

const n = (v: number) => v.toLocaleString("en-US");
const POLL_MS = 3000;

function StateBar({ s }: { s: CatalogState }) {
  const lines: [Tone, string][] = [
    [s.enabled ? "good" : "neutral", S.state.enabled(s.enabled)],
    s.available ? [s.asr ? "good" : "warn", S.state.asr(s.asr)] : ["bad", S.state.unavailable],
    [s.ai ? "good" : "warn", S.state.ai(s.ai)],
    [s.link ? "good" : "neutral", S.state.link(s.link, s.proxyConfigured)],
  ];
  return (
    <div className="panel space-y-2 px-4 py-3 text-sm">
      <div className="flex flex-wrap items-center gap-x-6 gap-y-2">
        {lines.map(([tone, label]) => <StatusDot key={label} tone={tone} label={label} />)}
      </div>
      <p className="num text-fg-2">{S.state.shared(n(s.aiToday), n(s.aiDaily))}</p>
      <p role="note" className="text-2xs text-muted">{S.backup}</p>
    </div>
  );
}

function StatusCell({ row }: { row: CatalogRow }) {
  const tone: Tone = row.status === "ready" ? "good" : row.status === "failed" ? "bad" : row.status === "canceled" ? "neutral" : "warn";
  const active = ACTIVE.includes(row.status);
  return (
    <span className="block space-y-1">
      <StatusDot tone={tone} label={S.status[row.status] ?? row.status} />
      {active && (
        <>
          {row.status === "processing" && row.stage && (
            <span className="num block text-2xs text-muted">{`${S.stage[row.stage] ?? row.stage} · ${row.progress}%`}</span>
          )}
          <span className="block h-1 w-24 overflow-hidden rounded-full bg-sunken" aria-hidden="true">
            <span className="block h-full rounded-full bg-accent" style={{ width: `${row.progress}%` }} />
          </span>
        </>
      )}
      {row.status === "failed" && row.errorKind && <span className="block text-2xs text-bad">{S.errorKinds[row.errorKind] ?? row.errorKind}</span>}
    </span>
  );
}

function Badges({ row }: { row: CatalogRow }) {
  const items: string[] = [];
  if (row.retired) items.push(S.badges.retired);
  if (row.mediaMissing) items.push(S.badges.mediaMissing);
  if (row.status === "ready" && row.translated < row.segCount) items.push(S.badges.partial);
  if (row.lowConfidence) items.push(S.badges.lowConfidence);
  return (
    <>
      {items.map((t) => (
        <span key={t} className="badge ml-1 bg-warn-soft text-warn">{t}</span>
      ))}
    </>
  );
}

function PublishSwitch({ row, onToggle, disabled }: { row: CatalogRow; onToggle: (row: CatalogRow) => void; disabled: boolean }) {
  const can = row.published || (row.status === "ready" && !row.retired && !row.mediaMissing);
  const on = row.published;
  return (
    <button
      type="button"
      role="switch"
      aria-label={S.cols.published}
      aria-checked={on}
      disabled={disabled || !can}
      onClick={() => onToggle(row)}
      className="inline-flex min-h-[32px] items-center disabled:opacity-50"
    >
      <span aria-hidden="true" className={`relative inline-block h-[18px] w-[32px] rounded-full transition-colors ${on ? "bg-good" : "bg-line-strong"}`}>
        <span className={`absolute top-[2px] h-[14px] w-[14px] rounded-full bg-surface transition-[left] ${on ? "left-[16px]" : "left-[2px]"}`} />
      </span>
    </button>
  );
}

/** /catalog:精选库(spec 2026-10-14-curated-library §11;桌面版式)。有处理中的条目时每 3 秒刷新(R-AU3)。 */
export function CatalogPage() {
  const session = useAdminSession();
  const canWrite = hasRole(session, "operator");
  const data = useAsync(fetchCatalog, []);
  const [importing, setImporting] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [openId, setOpenId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const rows = data.data?.items;
  const hasActive = !!rows?.some((r) => ACTIVE.includes(r.status));
  const { reload } = data;
  useEffect(() => {
    if (!hasActive) return;
    let timer: ReturnType<typeof setInterval> | null = null;
    const start = () => {
      if (!timer) timer = setInterval(reload, POLL_MS);
    };
    const stop = () => {
      if (timer) clearInterval(timer);
      timer = null;
    };
    const onVisibility = () => (document.visibilityState === "visible" ? start() : stop());
    if (document.visibilityState !== "hidden") start();
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      stop();
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [hasActive, reload]);

  const toggle = async (row: CatalogRow) => {
    setError(null);
    try {
      await (row.published ? unpublish(row.id) : publish(row.id));
    } catch (e) {
      setError(errorText(apiErrorText(e)));
    }
    reload();
  };

  const columns: Column<CatalogRow>[] = [
    {
      key: "title",
      header: S.cols.title,
      render: (r) => (
        <span className="block">
          <button type="button" className="font-medium text-accent hover:underline" onClick={() => setOpenId(r.id)}>{r.title}</button>
          <Badges row={r} />
          {r.licenseNote && <span className="block text-2xs text-muted">{r.licenseNote}</span>}
        </span>
      ),
    },
    { key: "level", header: S.cols.level, render: (r) => r.level ?? "—" },
    { key: "tags", header: S.cols.tags, render: (r) => (r.tags.length ? r.tags.join(" · ") : "—") },
    { key: "status", header: S.cols.status, render: (r) => <StatusCell row={r} /> },
    { key: "duration", header: S.cols.duration, numeric: true, render: (r) => (r.durationMs === null ? "—" : formatDuration(r.durationMs)) },
    { key: "sentences", header: S.cols.sentences, numeric: true, render: (r) => n(r.segCount) },
    { key: "translated", header: S.cols.translated, numeric: true, render: (r) => n(r.translated) },
    { key: "refs", header: S.cols.refs, numeric: true, render: (r) => n(r.refs) },
    { key: "published", header: S.cols.published, render: (r) => <PublishSwitch row={r} onToggle={toggle} disabled={!canWrite} /> },
  ];

  return (
    <Page
      title={S.title}
      actions={
        <RoleGate min="operator">
          <button type="button" className="btn-ghost btn-sm" onClick={reload}>{S.actions.refresh}</button>
          <button type="button" className="btn-ghost btn-sm" onClick={() => setUploading(true)}>{S.actions.upload}</button>
          <button type="button" className="btn-primary btn-sm" onClick={() => setImporting(true)}>{S.actions.importLink}</button>
        </RoleGate>
      }
    >
      <p className="text-xs text-fg-2">{S.intro}</p>
      {data.error && !data.data ? (
        <ErrorState message={data.error} onRetry={data.reload} />
      ) : !data.data ? (
        <Skeleton rows={4} />
      ) : (
        <>
          <StateBar s={data.data.state} />
          {error && <p role="alert" className="rounded-lg border border-bad/30 bg-bad-soft px-3 py-2 text-sm text-bad">{error}</p>}
          <div className="panel">
            <DataTable columns={columns} rows={data.data.items} empty={S.empty} rowKey={(r) => r.id} caption={S.title} />
          </div>
          <ImportDialog open={importing} state={data.data.state} onClose={() => setImporting(false)} onDone={reload} />
          {openId && <CatalogDetail id={openId} onClose={() => setOpenId(null)} onChanged={reload} />}
          <UploadDialog open={uploading} state={data.data.state} onClose={() => setUploading(false)} onDone={reload} />
        </>
      )}
    </Page>
  );
}
