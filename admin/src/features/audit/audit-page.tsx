import { useCallback, useEffect, useState, type FormEvent } from "react";
import { hasRole, useAdminSession } from "../../api/session";
import { SpinnerIcon } from "../../components/icons";
import { Page } from "../../components/layout";
import { EmptyState, ErrorState } from "../../components/states";
import { StatusDot } from "../../components/status-dot";
import { errorText } from "../../hooks/use-async";
import { listAudit, verifyAudit, type AuditFilters, type AuditItem } from "./api";
import { AuditRow } from "./audit-row";
import { ACTION_PREFIXES, S } from "./strings";

function IntegrityBar() {
  const [state, setState] = useState<{ ok: boolean; brokenAt: number | null } | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    verifyAudit().then(
      (r) => live && setState(r),
      (e) => live && setError(errorText(e)),
    );
    return () => {
      live = false;
    };
  }, []);
  if (error) return <p className="text-xs text-fg-2">{error}</p>;
  if (!state) return <p className="text-xs text-fg-2">{S.chainChecking}</p>;
  if (state.ok) {
    return (
      <p role="status" className="text-sm">
        <StatusDot tone="good" label={S.chainOk} />
      </p>
    );
  }
  return (
    <div role="alert" className="rounded-lg border border-bad/30 bg-bad-soft px-3 py-2 text-sm text-bad">
      <b className="font-semibold">{S.chainBroken(state.brokenAt ?? 0)}</b>
      <p className="mt-0.5 text-xs">{S.chainBrokenHint}</p>
    </div>
  );
}

/** 审计日志(spec §4.7):筛选(操作人、动作前缀、对象)、倒序列表、展开差异、哈希链完整性。只读角色只见自己的记录。 */
export function AuditPage() {
  const session = useAdminSession();
  const viewer = !hasRole(session, "operator");
  const [form, setForm] = useState<AuditFilters>({});
  const [filters, setFilters] = useState<AuditFilters>({});
  const [items, setItems] = useState<AuditItem[]>([]);
  const [next, setNext] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState<Record<number, boolean>>({});

  const load = useCallback(async (f: AuditFilters, beforeId?: number | null) => {
    setLoading(true);
    setError(null);
    try {
      const page = await listAudit({ ...f, beforeId });
      setItems((old) => (beforeId ? [...old, ...page.items] : page.items));
      setNext(page.nextBeforeId);
    } catch (e) {
      setError(errorText(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load(filters);
  }, [filters, load]);

  const submit = (e: FormEvent) => {
    e.preventDefault();
    setOpen({});
    setFilters({ ...form });
  };

  return (
    <Page title={S.auditPage} actions={!viewer ? <IntegrityBar /> : undefined}>
      <form aria-label={S.filters} className="panel flex flex-wrap items-end gap-3 px-4 py-3" onSubmit={submit}>
        <label className="block space-y-1">
          <span className="text-xs font-medium text-fg-2">{S.actor}</span>
          <input
            className="field-sm w-[180px] font-mono"
            value={viewer ? (session?.username ?? "") : (form.actor ?? "")}
            disabled={viewer}
            title={viewer ? S.ownOnly : undefined}
            onChange={(e) => setForm((f) => ({ ...f, actor: e.target.value }))}
          />
        </label>
        <label className="block space-y-1">
          <span className="text-xs font-medium text-fg-2">{S.action}</span>
          <select
            className="field-sm w-[220px]"
            value={form.actionPrefix ?? ""}
            onChange={(e) => {
              const actionPrefix = e.target.value || undefined;
              setForm((f) => ({ ...f, actionPrefix }));
              setOpen({});
              setFilters((f) => ({ ...f, actionPrefix }));
            }}
          >
            <option value="">{S.allActions}</option>
            {ACTION_PREFIXES.map((p) => (
              <option key={p.value} value={p.value}>
                {p.label}
              </option>
            ))}
          </select>
        </label>
        <label className="block space-y-1">
          <span className="text-xs font-medium text-fg-2">{S.target}</span>
          <input className="field-sm w-[220px]" value={form.targetId ?? ""} placeholder={S.targetHint} onChange={(e) => setForm((f) => ({ ...f, targetId: e.target.value }))} />
        </label>
        <button type="submit" className="btn-primary btn-sm">
          {S.apply}
        </button>
        <button
          type="button"
          className="btn-ghost btn-sm"
          onClick={() => {
            setForm({});
            setOpen({});
            setFilters({});
          }}
        >
          {S.reset}
        </button>
        {viewer && <p className="w-full text-2xs text-fg-2">{S.ownOnly}</p>}
      </form>

      {error && items.length === 0 ? (
        <ErrorState message={error} onRetry={() => load(filters)} />
      ) : !loading && items.length === 0 ? (
        <EmptyState message={S.empty} />
      ) : (
        <div className="panel overflow-x-auto">
          <table className="w-full border-collapse text-sm">
            <caption className="sr-only">{S.auditPage}</caption>
            <thead>
              <tr>
                {[S.cols.at, S.cols.actor, S.cols.action, S.cols.target, S.cols.summary, S.cols.result, ""].map((h, i) => (
                  <th key={i} scope="col" className="whitespace-nowrap border-b border-line px-3 py-2 text-left text-2xs font-medium tracking-wide text-fg-2">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {items.map((item) => (
                <AuditRow key={item.id} item={item} open={!!open[item.id]} onToggle={() => setOpen((o) => ({ ...o, [item.id]: !o[item.id] }))} />
              ))}
            </tbody>
          </table>
        </div>
      )}
      {loading && <SpinnerIcon width={16} height={16} />}
      {error && items.length > 0 && <p role="alert" className="text-sm text-bad">{error}</p>}
      {next !== null && !loading && (
        <button type="button" className="btn-ghost btn-sm" onClick={() => load(filters, next)}>
          {S.loadMore}
        </button>
      )}
    </Page>
  );
}
