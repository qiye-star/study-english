import { useState, type FormEvent, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { ConfirmDialog } from "../../components/confirm-dialog";
import { DataTable, type Column } from "../../components/data-table";
import { Page } from "../../components/layout";
import { RoleGate } from "../../components/role-gate";
import { ErrorState, Skeleton } from "../../components/states";
import { StatusDot } from "../../components/status-dot";
import { errorText, useAsync } from "../../hooks/use-async";
import { formatDateTime } from "../../lib/format";
import {
  deletePersona,
  disablePersona,
  fetchAgentsOverview,
  fetchPersonaReports,
  fetchPersonas,
  resolveReports,
  restorePersona,
  runToolsProbe,
  type AdminPersona,
  type AgentsOverview,
  type PersonaReportRow,
  type PersonaStatus,
} from "./api";
import { PersonaDialog } from "./persona-dialog";
import { S } from "./strings";

const n = (v: number) => v.toLocaleString("en-US");

type Pending =
  | { kind: "disable" | "restore" | "delete"; persona: AdminPersona }
  | { kind: "dismiss" | "disableReported"; report: PersonaReportRow };

type DayRow = { day: string; turns: number; tutor: number; memory: number };

const DAY_COLUMNS: Column<DayRow>[] = [
  { key: "day", header: S.weekCols.day, render: (d) => <span className="num">{d.day}</span> },
  { key: "turns", header: S.weekCols.turns, numeric: true, render: (d) => n(d.turns) },
  { key: "tutor", header: S.weekCols.tutor, numeric: true, render: (d) => n(d.tutor) },
  { key: "memory", header: S.weekCols.memory, numeric: true, render: (d) => n(d.memory) },
];

function Kpi({ id, label, value, note }: { id: string; label: string; value: ReactNode; note: ReactNode }) {
  return (
    <div className="panel space-y-1 px-4 py-3" data-testid={`agents-kpi-${id}`}>
      <p className="text-xs font-medium text-fg-2">{label}</p>
      <div className="num text-xl font-semibold leading-tight">{value}</div>
      <div className="truncate text-xs text-fg-2">{note}</div>
    </div>
  );
}

function Switches({ o }: { o: AgentsOverview }) {
  const items: [string, boolean][] = [
    [S.switches.enabled, o.switches.enabled],
    [S.switches.tutor, o.switches.tutor],
    [S.switches.memory, o.switches.memory],
    [S.switches.rooms, o.switches.rooms],
  ];
  return (
    <div className="panel flex flex-wrap items-center gap-x-5 gap-y-2 px-4 py-3 text-sm">
      {items.map(([label, on]) => (
        <StatusDot key={label} tone={on ? "good" : "neutral"} label={`${label} · ${on ? S.on : S.off}`} />
      ))}
      {o.switches.enabled && !o.available && <span className="text-warn">{S.unavailable}</span>}
      <Link className="ml-auto text-accent hover:underline" to="/settings/agents">
        {S.toSettings}
      </Link>
    </div>
  );
}

function Tools({ o, busy, error, onProbe }: { o: AgentsOverview; busy: boolean; error: string | null; onProbe: () => void }) {
  const probe = o.toolsMode.probe;
  return (
    <div className="panel space-y-1.5 px-4 py-3 text-sm">
      <p>{S.tools.mode(o.toolsMode.configured, o.toolsMode.effective)}</p>
      <p className="text-fg-2">{probe ? S.tools.probe(probe.ok, probe.code, n(probe.ms), formatDateTime(probe.at)) : S.tools.noProbe}</p>
      <p className="text-xs text-muted">{S.tools.note}</p>
      <RoleGate min="operator">
        <button type="button" className="btn-ghost btn-sm" disabled={busy} onClick={onProbe}>
          {S.tools.run}
        </button>
      </RoleGate>
      {error && (
        <p role="alert" className="text-bad">
          {S.failed(error)}
        </p>
      )}
    </div>
  );
}

/** /agents:智能体开关、工具方式与探测、计数(无内容)、角色举报、自建角色审核(spec 2026-10-12-agents §10.2;桌面版式)。 */
export function AgentsPage() {
  const overview = useAsync(fetchAgentsOverview, []);
  const reports = useAsync(fetchPersonaReports, []);
  const [draft, setDraft] = useState("");
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState<PersonaStatus>("all");
  const [page, setPage] = useState(1);
  const list = useAsync(() => fetchPersonas(query, status, page), [query, status, page]);
  const [pending, setPending] = useState<Pending | null>(null);
  const [viewing, setViewing] = useState<AdminPersona | null>(null);
  const [probing, setProbing] = useState(false);
  const [probeError, setProbeError] = useState<string | null>(null);

  const reloadAll = () => {
    overview.reload();
    reports.reload();
    list.reload();
  };

  const probe = async () => {
    setProbing(true);
    setProbeError(null);
    try {
      await runToolsProbe();
      overview.reload();
    } catch (e) {
      setProbeError(errorText(e));
    } finally {
      setProbing(false);
    }
  };

  const search = (e: FormEvent) => {
    e.preventDefault();
    setPage(1);
    setQuery(draft.trim());
  };

  const confirm = async (reason: string) => {
    if (!pending) return;
    if ("persona" in pending) {
      if (pending.kind === "disable") await disablePersona(pending.persona.id, reason);
      else if (pending.kind === "restore") await restorePersona(pending.persona.id, reason);
      else await deletePersona(pending.persona.id, reason);
    } else await resolveReports(pending.report.personaId, pending.kind === "dismiss" ? "dismiss" : "disable", reason);
    setPending(null);
    reloadAll();
  };

  const dialog = pending
    ? {
        disable: { title: S.confirm.disableTitle, body: S.confirm.disableBody, danger: true },
        restore: { title: S.confirm.restoreTitle, body: S.confirm.restoreBody, danger: false },
        delete: { title: S.confirm.deleteTitle, body: S.confirm.deleteBody, danger: true },
        dismiss: { title: S.confirm.dismissTitle, body: S.confirm.dismissBody, danger: false },
        disableReported: { title: S.confirm.disableReportedTitle, body: S.confirm.disableReportedBody, danger: true },
      }[pending.kind]
    : { title: "", body: "", danger: false };

  const reportColumns: Column<PersonaReportRow>[] = [
    { key: "name", header: S.reportCols.name, render: (r) => <span className="font-medium">{r.name}</span> },
    { key: "owner", header: S.reportCols.owner, render: (r) => r.owner ?? "—" },
    { key: "count", header: S.reportCols.count, numeric: true, render: (r) => n(r.count) },
    {
      key: "reasons",
      header: S.reportCols.reasons,
      render: (r) => Object.entries(r.reasons).map(([k, v]) => `${S.reasons[k] ?? k} ${v}`).join(" · "),
    },
    { key: "last", header: S.reportCols.last, render: (r) => <span className="num text-fg-2">{formatDateTime(r.lastAt)}</span> },
    {
      key: "actions",
      header: S.reportCols.actions,
      align: "right",
      render: (r) => (
        <RoleGate min="operator">
          <span className="inline-flex gap-1">
            <button type="button" className="btn-ghost btn-sm" onClick={() => setPending({ kind: "dismiss", report: r })}>
              {S.dismiss}
            </button>
            {!r.disabled && (
              <button type="button" className="btn-ghost btn-sm" onClick={() => setPending({ kind: "disableReported", report: r })}>
                {S.disableReported}
              </button>
            )}
          </span>
        </RoleGate>
      ),
    },
  ];

  const personaColumns: Column<AdminPersona>[] = [
    {
      key: "name",
      header: S.personaCols.name,
      render: (p) => (
        <span className="block">
          <span className="block font-medium">{p.name}</span>
          <span className="block max-w-[360px] truncate text-2xs text-muted">{p.intro}</span>
        </span>
      ),
    },
    { key: "owner", header: S.personaCols.owner, render: (p) => p.owner ?? "—" },
    {
      key: "status",
      header: S.personaCols.status,
      render: (p) => <StatusDot tone={p.disabled ? "warn" : "good"} label={p.disabled ? S.disabled : S.active} />,
    },
    { key: "reports", header: S.personaCols.reports, numeric: true, render: (p) => n(p.reportsOpen) },
    { key: "created", header: S.personaCols.created, render: (p) => <span className="num text-fg-2">{formatDateTime(p.createdAt)}</span> },
    {
      key: "actions",
      header: S.personaCols.actions,
      align: "right",
      render: (p) => (
        <span className="inline-flex gap-1">
          <button type="button" className="btn-ghost btn-sm" onClick={() => setViewing(p)}>
            {S.view}
          </button>
          <RoleGate min="operator">
            <button type="button" className="btn-ghost btn-sm" onClick={() => setPending({ kind: p.disabled ? "restore" : "disable", persona: p })}>
              {p.disabled ? S.restore : S.disable}
            </button>
          </RoleGate>
          <RoleGate min="superadmin">
            <button type="button" className="btn-ghost btn-sm text-bad" onClick={() => setPending({ kind: "delete", persona: p })}>
              {S.remove}
            </button>
          </RoleGate>
        </span>
      ),
    },
  ];

  const o = overview.data;
  return (
    <Page title={S.title}>
      {overview.error ? (
        <ErrorState message={overview.error} onRetry={overview.reload} />
      ) : !o ? (
        <Skeleton rows={3} />
      ) : (
        <>
          <Switches o={o} />
          <Tools o={o} busy={probing} error={probeError} onProbe={() => void probe()} />
          <div className="grid grid-cols-4 gap-3">
            <Kpi id="turns" label={S.kpi.turns} value={n(o.usage.today.turns)} note={S.kpi.turnsNote(n(o.limits.turnsGlobalDaily))} />
            <Kpi id="calls" label={S.kpi.calls} value={n(o.usage.today.calls)} note={S.kpi.callsNote(n(o.usage.today.errors))} />
            <Kpi
              id="tokens"
              label={S.kpi.tokens}
              value={n(o.usage.today.tokensIn + o.usage.today.tokensOut)}
              note={S.kpi.tokensNote(n(o.usage.today.tokensIn), n(o.usage.today.tokensOut))}
            />
            <Kpi id="personas" label={S.kpi.personas} value={n(o.personas.total)} note={S.kpi.personasNote(n(o.personas.disabled), n(o.personas.reportsOpen))} />
          </div>
          <div className="panel">
            <DataTable<DayRow>
              caption={S.week}
              columns={DAY_COLUMNS}
              rows={o.usage.days.map((day, i) => ({ day, turns: o.usage.turns[i], tutor: o.usage.tutor[i], memory: o.usage.memory[i] }))}
              empty={S.week}
              rowKey={(d) => d.day}
            />
          </div>
          <p className="text-xs text-muted">{S.countsNote}</p>
        </>
      )}

      <h2 className="pt-2 text-sm font-semibold">{S.reports}</h2>
      {reports.error ? (
        <ErrorState message={reports.error} onRetry={reports.reload} />
      ) : !reports.data ? (
        <Skeleton rows={2} />
      ) : reports.data.reports.length === 0 ? (
        <p className="panel px-3 py-6 text-center text-sm text-muted">{S.reportsEmpty}</p>
      ) : (
        <div className="panel overflow-x-auto">
          <table className="w-full border-collapse text-sm">
            <caption className="sr-only">{S.reports}</caption>
            <thead>
              <tr>
                {reportColumns.map((c) => (
                  <th key={c.key} scope="col" className={`whitespace-nowrap border-b border-line px-3 py-2 text-2xs font-medium text-fg-2 ${c.numeric || c.align === "right" ? "text-right" : "text-left"}`}>
                    {c.header}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {reports.data.reports.map((r) => (
                <tr key={r.personaId} data-testid={`agents-report-${r.personaId}`}>
                  {reportColumns.map((c) => (
                    <td key={c.key} className={`border-b border-line px-3 py-2.5 ${c.numeric || c.align === "right" ? "num text-right" : ""}`}>
                      {c.render(r)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <h2 className="pt-2 text-sm font-semibold">{S.personas}</h2>
      <form role="search" className="flex flex-wrap items-center gap-2" onSubmit={search}>
        <input className="field-sm w-[320px]" aria-label={S.search} placeholder={S.search} value={draft} maxLength={40} onChange={(e) => setDraft(e.target.value)} />
        <select className="field-sm w-[140px]" aria-label={S.personaCols.status} value={status} onChange={(e) => { setPage(1); setStatus(e.target.value as PersonaStatus); }}>
          {Object.entries(S.statuses).map(([k, v]) => (
            <option key={k} value={k}>
              {v}
            </option>
          ))}
        </select>
        <button type="submit" className="btn-ghost btn-sm">
          {S.searchButton}
        </button>
      </form>
      {list.error ? (
        <ErrorState message={list.error} onRetry={list.reload} />
      ) : !list.data ? (
        <Skeleton rows={3} />
      ) : list.data.items.length === 0 ? (
        <p className="panel px-3 py-6 text-center text-sm text-muted">{S.personasEmpty}</p>
      ) : (
        <div className="panel overflow-x-auto">
          <table className="w-full border-collapse text-sm">
            <caption className="sr-only">{S.personas}</caption>
            <thead>
              <tr>
                {personaColumns.map((c) => (
                  <th key={c.key} scope="col" className={`whitespace-nowrap border-b border-line px-3 py-2 text-2xs font-medium text-fg-2 ${c.numeric || c.align === "right" ? "text-right" : "text-left"}`}>
                    {c.header}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {list.data.items.map((p) => (
                <tr key={p.id} data-testid={`agents-persona-${p.id}`}>
                  {personaColumns.map((c) => (
                    <td key={c.key} className={`border-b border-line px-3 py-2.5 align-top ${c.numeric || c.align === "right" ? "num text-right" : ""}`}>
                      {c.render(p)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
          {list.data.next !== null && (
            <div className="px-3 py-2 text-right">
              <button type="button" className="btn-ghost btn-sm" onClick={() => setPage(list.data!.next ?? page)}>
                {S.more}
              </button>
            </div>
          )}
        </div>
      )}

      <PersonaDialog
        persona={viewing}
        onClose={() => setViewing(null)}
        onSaved={() => {
          setViewing(null);
          reloadAll();
        }}
      />
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
