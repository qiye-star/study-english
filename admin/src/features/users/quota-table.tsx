import { useState } from "react";
import { errorText, useAsync } from "../../hooks/use-async";
import { ErrorState, Skeleton } from "../../components/states";
import { formatDateTime } from "../../lib/format";
import { clearQuota, getQuotas, setQuota, type QuotaItem } from "./api";
import { S } from "./strings";

const Q = S.quotas;

/** ISO → datetime-local 输入框的值(本地时区) */
function toLocalInput(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const off = d.getTimezoneOffset() * 60_000;
  return new Date(d.getTime() - off).toISOString().slice(0, 16);
}

function fromLocalInput(value: string): string | null {
  if (!value) return null;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

function EditRow({ item, userId, onDone, onCancel }: { item: QuotaItem; userId: string | number; onDone: () => void; onCancel: () => void }) {
  const [value, setValue] = useState(item.override !== null ? String(item.override) : "");
  const [expires, setExpires] = useState(toLocalInput(item.expiresAt));
  const [note, setNote] = useState(item.note ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const save = async () => {
    const n = Number(value);
    if (value.trim() === "" || !Number.isInteger(n) || n < 0) {
      setError(Q.invalid);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await setQuota(userId, item.key, { value: n, expiresAt: fromLocalInput(expires), note: note.trim() });
      onDone();
    } catch (e) {
      setError(errorText(e));
      setBusy(false);
    }
  };

  return (
    <>
      <td className="border-b border-line px-3 py-2">
        <input aria-label={Q.override} className="field-sm num w-28 text-right" inputMode="numeric" value={value} onChange={(e) => setValue(e.target.value)} />
      </td>
      <td className="border-b border-line px-3 py-2">
        <input aria-label={Q.expires} type="datetime-local" className="field-sm w-48" value={expires} onChange={(e) => setExpires(e.target.value)} />
      </td>
      <td className="border-b border-line px-3 py-2">
        <input aria-label={Q.note} className="field-sm" maxLength={200} value={note} onChange={(e) => setNote(e.target.value)} />
        {error && (
          <p role="alert" className="mt-1 text-xs text-bad">
            {error}
          </p>
        )}
      </td>
      <td className="whitespace-nowrap border-b border-line px-3 py-2 text-right">
        <button type="button" className="btn-primary btn-sm" disabled={busy} onClick={() => void save()}>
          {Q.save}
        </button>{" "}
        <button type="button" className="btn-ghost btn-sm" disabled={busy} onClick={onCancel}>
          {Q.cancel}
        </button>
      </td>
    </>
  );
}

/** 配额覆盖表:键、全站默认、覆盖值、到期、备注;行内编辑(operator)。 */
export function QuotaTable({ userId }: { userId: string | number }) {
  const { data, error, reload } = useAsync(() => getQuotas(userId), [userId]);
  const [editing, setEditing] = useState<string | null>(null);
  const [rowError, setRowError] = useState<string | null>(null);

  if (error) return <ErrorState message={error} onRetry={reload} />;
  if (!data) return <Skeleton rows={3} />;

  const clear = async (key: string) => {
    setRowError(null);
    try {
      await clearQuota(userId, key);
      reload();
    } catch (e) {
      setRowError(errorText(e));
    }
  };

  return (
    <section className="panel" aria-label={Q.title}>
      <div className="panel-head">
        <h2 className="text-sm font-semibold">{Q.title}</h2>
        <p className="text-xs text-muted">{Q.hint}</p>
      </div>
      {rowError && (
        <p role="alert" className="px-4 pb-2 text-sm text-bad">
          {rowError}
        </p>
      )}
      <table className="w-full border-collapse text-sm">
        <thead>
          <tr>
            {[Q.key, Q.default, Q.override, Q.expires, Q.note, Q.actions].map((h, i) => (
              <th key={h} scope="col" className={`border-b border-line px-3 py-2 text-2xs font-medium tracking-wide text-fg-2 ${i === 1 || i === 2 || i === 5 ? "text-right" : "text-left"}`}>
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {data.items.map((item) => {
            const live = item.override !== null;
            return (
              <tr key={item.key} data-testid={`quota-${item.key}`}>
                <td className="border-b border-line px-3 py-2.5">
                  <span className="font-medium">{Q.labels[item.key] ?? item.key}</span>
                  <span className="ml-2 font-mono text-2xs text-muted">{item.key}</span>
                </td>
                <td className="num border-b border-line px-3 py-2.5 text-right text-fg-2">{item.default}</td>
                {editing === item.key ? (
                  <EditRow
                    item={item}
                    userId={userId}
                    onCancel={() => setEditing(null)}
                    onDone={() => {
                      setEditing(null);
                      reload();
                    }}
                  />
                ) : (
                  <>
                    <td className="num border-b border-line px-3 py-2.5 text-right font-semibold">
                      {live ? item.override : item.expired ? <span className="badge bg-warn-soft text-warn">{Q.expired}</span> : Q.none}
                    </td>
                    <td className="num border-b border-line px-3 py-2.5 text-fg-2">
                      {live || item.expired ? (item.expiresAt ? formatDateTime(item.expiresAt) : Q.never) : Q.none}
                    </td>
                    <td className="border-b border-line px-3 py-2.5 text-fg-2">{item.note || Q.none}</td>
                    <td className="whitespace-nowrap border-b border-line px-3 py-2.5 text-right">
                      <button type="button" className="btn-ghost btn-sm" onClick={() => setEditing(item.key)}>
                        {live ? Q.change : Q.edit}
                      </button>
                      {(live || item.expired) && (
                        <>
                          {" "}
                          <button type="button" className="btn-quiet btn-sm" onClick={() => void clear(item.key)}>
                            {Q.clear}
                          </button>
                        </>
                      )}
                    </td>
                  </>
                )}
              </tr>
            );
          })}
        </tbody>
      </table>
    </section>
  );
}
