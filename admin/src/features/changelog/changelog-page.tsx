import { useEffect, useState } from "react";
import { hasRole, useAdminSession } from "../../api/session";
import { Chips, Page } from "../../components/layout";
import { EmptyState, ErrorState, Skeleton } from "../../components/states";
import { errorText } from "../../hooks/use-async";
import { listEntries, type ChangelogEntry, type EntryStatus } from "./api";
import { EntryEditor } from "./entry-editor";
import { S } from "./strings";

type Filter = "all" | EntryStatus;

const BADGE: Record<EntryStatus, string> = { draft: "bg-warn-soft text-warn", published: "bg-good-soft text-good" };

/** 更新日志(spec D6):左列表(草稿 / 已发布)+ 右编辑器。查看者可读,操作员及以上可写;写操作都进审计(只记 id 与动作)。 */
export function ChangelogPage() {
  const canWrite = hasRole(useAdminSession(), "operator");
  const [entries, setEntries] = useState<ChangelogEntry[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<number | "new" | null>(null);
  const [filter, setFilter] = useState<Filter>("all");
  const [tick, setTick] = useState(0);
  const reload = () => setTick((t) => t + 1);

  useEffect(() => {
    let live = true;
    setError(null);
    Promise.resolve(listEntries())
      .then((rows) => live && setEntries(rows ?? []))
      .catch((e) => live && setError(errorText(e)));
    return () => {
      live = false;
    };
  }, [tick]);

  const shown = (entries ?? []).filter((e) => filter === "all" || e.status === filter);
  const current = typeof selected === "number" ? (entries ?? []).find((e) => e.id === selected) ?? null : null;

  return (
    <Page
      title={S.title}
      actions={canWrite ? <button type="button" className="btn-primary btn-sm" onClick={() => setSelected("new")}>{S.create}</button> : undefined}
    >
      <p className="text-sm text-fg-2">{S.intro}</p>
      {error ? (
        <ErrorState message={error} onRetry={reload} />
      ) : entries === null ? (
        <Skeleton rows={3} />
      ) : entries.length === 0 && selected !== "new" ? (
        <EmptyState message={S.empty} />
      ) : (
        <div className="grid grid-cols-[340px_minmax(0,1fr)] items-start gap-4">
          <div className="space-y-3">
            <Chips<Filter> label={S.filter} value={filter} onChange={setFilter}
              options={[{ value: "all", label: S.all }, { value: "draft", label: S.status.draft }, { value: "published", label: S.status.published }]} />
            <ul aria-label={S.list} className="panel divide-y divide-line overflow-hidden">
              {shown.map((e) => (
                <li key={e.id}>
                  <button type="button" aria-current={selected === e.id ? "true" : undefined} onClick={() => setSelected(e.id)}
                    className={`block w-full px-3.5 py-3 text-left hover:bg-sunken ${selected === e.id ? "bg-accent-soft" : ""}`}>
                    <span className="flex items-center gap-2 text-xs text-muted">
                      <span className="num">{e.entryDate}</span>
                      {e.version && <span>{e.version}</span>}
                      <span className={`badge ${BADGE[e.status]}`}>{S.status[e.status]}</span>
                    </span>
                    <span className="mt-0.5 block truncate font-semibold">{e.titleZh}</span>
                  </button>
                </li>
              ))}
            </ul>
          </div>
          {selected === "new" ? (
            <EntryEditor key="new" initial={null} onChanged={(id) => { setSelected(id); reload(); }} onDeleted={() => undefined} />
          ) : current ? (
            <EntryEditor key={`${current.id}:${current.updatedAt}`} initial={current}
              onChanged={(id) => { setSelected(id); reload(); }} onDeleted={() => { setSelected(null); reload(); }} />
          ) : (
            <EmptyState message={S.pickOne} />
          )}
        </div>
      )}
    </Page>
  );
}
