import { useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { ConfirmDialog } from "../../components/confirm-dialog";
import { DataTable, type Column } from "../../components/data-table";
import { Page } from "../../components/layout";
import { RoleGate } from "../../components/role-gate";
import { ErrorState, Skeleton } from "../../components/states";
import { StatusDot } from "../../components/status-dot";
import { useAsync } from "../../hooks/use-async";
import { formatBytes, formatDateTime } from "../../lib/format";
import {
  dismissReport,
  fetchReports,
  fetchWordbookAdmin,
  hideReport,
  reloadWordbook,
  type WordbookAdmin,
  type WordbookBookAdmin,
  type WordbookReportRow,
} from "./api";
import { S } from "./strings";

const n = (v: number) => v.toLocaleString("en-US");

type Pending = { kind: "reload" } | { kind: "hide" | "dismiss"; report: WordbookReportRow };

function AiSummary({ ai }: { ai: WordbookAdmin["ai"] }) {
  if (!ai.enabled) return <StatusDot tone="neutral" label={S.ai.off} />;
  return (
    <span className="inline-flex items-center gap-3">
      <StatusDot tone={ai.available ? "good" : "warn"} label={S.ai.on(n(ai.todayCalls), n(ai.globalDaily), n(ai.cached))} />
      {!ai.available && <span className="text-warn">{S.ai.unavailable}</span>}
    </span>
  );
}

function FileCell({ book }: { book: WordbookBookAdmin }) {
  const { file } = book;
  if (file.bytes === 0) return <StatusDot tone="bad" label={S.fileMissing} />;
  const sha = file.sha256Ok === true ? ["good", S.sha.ok] as const : file.sha256Ok === false ? ["bad", S.sha.bad] as const : ["neutral", S.sha.none] as const;
  return (
    <span className="block space-y-0.5">
      <span className="num block">{formatBytes(file.bytes)}</span>
      <StatusDot tone={sha[0]} label={sha[1]} />
      <span className="num block text-2xs text-muted">{S.entries(n(file.entries), n(file.unique))}</span>
    </span>
  );
}

function IndexCell({ book }: { book: WordbookBookAdmin }) {
  const { index } = book;
  return (
    <span className="block space-y-0.5">
      {index.loaded ? (
        <>
          <span className="block">
            <span className="num">{n(index.keys)}</span> <span className="text-fg-2">{S.keys}</span>
          </span>
          <span className="num block text-2xs text-muted">
            {S.indexLoaded(n(index.dropped), index.builtMs === null ? "—" : n(index.builtMs))}
          </span>
        </>
      ) : (
        <span className="text-muted">{S.notLoaded}</span>
      )}
      {index.stale && <StatusDot tone="warn" label={S.stale} />}
    </span>
  );
}

const BOOK_COLUMNS: { key: string; header: string; numeric?: boolean; render: (b: WordbookBookAdmin) => ReactNode }[] = [
  { key: "book", header: S.cols.book, render: (b) => <span className="font-medium">{b.titleZh}</span> },
  {
    key: "enabled",
    header: S.cols.enabled,
    render: () => (
      <Link className="text-accent hover:underline" to="/settings/wordbook" title={S.editBooks}>
        {S.enabledYes}
      </Link>
    ),
  },
  { key: "file", header: S.cols.file, render: (b) => <FileCell book={b} /> },
  { key: "index", header: S.cols.index, render: (b) => <IndexCell book={b} /> },
  { key: "learners", header: S.cols.learners, numeric: true, render: (b) => n(b.learners) },
  { key: "learners7d", header: S.cols.learners7d, numeric: true, render: (b) => n(b.learners7d) },
  { key: "learned", header: S.cols.learned, numeric: true, render: (b) => n(b.learned) },
  { key: "mastered", header: S.cols.mastered, numeric: true, render: (b) => n(b.mastered) },
  { key: "reportsOpen", header: S.cols.reportsOpen, numeric: true, render: (b) => n(b.reportsOpen) },
];

/** 书表:与 DataTable 同样式,但每行带 data-testid(DataTable 不支持行属性)。 */
function BooksTable({ books }: { books: WordbookBookAdmin[] }) {
  if (books.length === 0) return <p className="px-3 py-6 text-center text-sm text-muted">{S.booksEmpty}</p>;
  return (
    <div className="overflow-x-auto">
      <table className="w-full border-collapse text-sm">
        <caption className="sr-only">{S.title}</caption>
        <thead>
          <tr>
            {BOOK_COLUMNS.map((c) => (
              <th
                key={c.key}
                scope="col"
                className={`whitespace-nowrap border-b border-line px-3 py-2 text-2xs font-medium tracking-wide text-fg-2 ${c.numeric ? "text-right" : "text-left"}`}
              >
                {c.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {books.map((b) => (
            <tr key={b.id} data-testid={`wordbook-book-${b.id}`}>
              {BOOK_COLUMNS.map((c) => (
                <td key={c.key} className={`border-b border-line px-3 py-2.5 align-top ${c.numeric ? "num text-right" : ""}`}>
                  {c.render(b)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** /wordbook:词书文件与学习统计、重新加载词典、例句举报(spec 2026-10-10-wordbook §9;桌面版式 R-7)。 */
export function WordbookPage() {
  const overview = useAsync(fetchWordbookAdmin, []);
  const reports = useAsync(fetchReports, []);
  const [pending, setPending] = useState<Pending | null>(null);

  const reloadBoth = () => {
    overview.reload();
    reports.reload();
  };

  const confirm = async (reason: string) => {
    if (!pending) return;
    if (pending.kind === "reload") await reloadWordbook(reason);
    else if (pending.kind === "hide") await hideReport(pending.report.id, reason);
    else await dismissReport(pending.report.id, reason);
    setPending(null);
    reloadBoth();
  };

  const reportColumns: Column<WordbookReportRow>[] = [
    { key: "book", header: S.reportCols.book, render: (r) => overview.data?.books.find((b) => b.id === r.bookId)?.titleZh ?? r.bookId },
    { key: "word", header: S.reportCols.word, render: (r) => <span className="font-medium">{r.word}</span> },
    {
      key: "sentence",
      header: S.reportCols.sentence,
      className: "max-w-[420px]",
      render: (r) => (r.sentence ? <span className="line-clamp-2 break-words">{r.sentence}</span> : <span className="text-muted">{S.sentenceMissing}</span>),
    },
    { key: "reason", header: S.reportCols.reason, render: (r) => S.reasons[r.reason] ?? r.reason },
    { key: "count", header: S.reportCols.count, numeric: true, render: (r) => n(r.count) },
    { key: "time", header: S.reportCols.time, render: (r) => <span className="num text-fg-2">{formatDateTime(r.createdAt)}</span> },
    {
      key: "actions",
      header: S.reportCols.actions,
      align: "right",
      render: (r) => (
        <RoleGate min="operator">
          <span className="inline-flex gap-1">
            <button type="button" className="btn-ghost btn-sm" onClick={() => setPending({ kind: "hide", report: r })}>
              {S.hide}
            </button>
            <button type="button" className="btn-ghost btn-sm" onClick={() => setPending({ kind: "dismiss", report: r })}>
              {S.dismiss}
            </button>
          </span>
        </RoleGate>
      ),
    },
  ];

  const dialog =
    pending?.kind === "reload"
      ? { title: S.reloadTitle, body: S.reloadBody, danger: false }
      : pending?.kind === "hide"
        ? { title: S.hideTitle, body: S.hideBody, danger: true }
        : { title: S.dismissTitle, body: S.dismissBody, danger: false };

  return (
    <Page
      title={S.title}
      actions={
        <RoleGate min="operator">
          <button type="button" className="btn-ghost btn-sm" onClick={() => setPending({ kind: "reload" })}>
            {S.reload}
          </button>
        </RoleGate>
      }
    >
      {overview.error ? (
        <ErrorState message={overview.error} onRetry={overview.reload} />
      ) : !overview.data ? (
        <Skeleton rows={4} />
      ) : (
        <>
          <div className="panel flex flex-wrap items-center justify-between gap-3 px-4 py-3 text-sm">
            <AiSummary ai={overview.data.ai} />
            {!overview.data.enabled && (
              <span className="text-fg-2">
                {S.disabled}{" "}
                <Link className="text-accent hover:underline" to="/settings/features">
                  {S.toSettings}
                </Link>
              </span>
            )}
          </div>
          <div className="panel">
            <BooksTable books={overview.data.books} />
          </div>
        </>
      )}
      <h2 className="pt-2 text-sm font-semibold">{S.reports}</h2>
      {reports.error ? (
        <ErrorState message={reports.error} onRetry={reports.reload} />
      ) : !reports.data ? (
        <Skeleton rows={2} />
      ) : (
        <div className="panel">
          <DataTable columns={reportColumns} rows={reports.data.reports} empty={S.reportsEmpty} rowKey={(r) => r.id} caption={S.reports} />
        </div>
      )}
      <ConfirmDialog
        open={pending !== null}
        title={dialog.title}
        body={dialog.body}
        danger={dialog.danger}
        reasonRequired
        onConfirm={confirm}
        onClose={() => setPending(null)}
      />
    </Page>
  );
}
