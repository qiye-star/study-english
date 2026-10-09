import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { Page } from "../../components/layout";
import { ErrorState } from "../../components/states";
import { errorText } from "../../hooks/use-async";
import { formatTime } from "../../lib/format";
import { getLogs, type LogEntry } from "./api";
import { S } from "./strings";

const L = S.logs;
const LEVELS = ["DEBUG", "INFO", "WARNING", "ERROR"];
const KEEP = 2000;
const POLL_MS = 5000;

function levelClass(level: string): string {
  if (level === "WARNING") return "text-warn";
  if (level === "ERROR" || level === "CRITICAL") return "text-bad";
  return "text-fg-2";
}

interface Filters {
  level: string;
  logger: string;
  q: string;
}

const query = (f: Filters, afterId?: number) => ({
  level: f.level || undefined,
  logger: f.logger.trim() || undefined,
  q: f.q.trim() || undefined,
  afterId,
});

/** 脱敏日志(operator):级别 / logger 前缀 / 关键字筛选;自动刷新用 after_id 增量拉取。 */
export function LogsPage() {
  const [draft, setDraft] = useState<Filters>({ level: "", logger: "", q: "" });
  const [filters, setFilters] = useState<Filters>(draft);
  const [entries, setEntries] = useState<LogEntry[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [auto, setAuto] = useState(false);
  const lastId = useRef<number | undefined>(undefined);
  const busy = useRef(false);

  const load = useCallback(async (f: Filters) => {
    busy.current = true;
    try {
      const rows = (await getLogs(query(f))) ?? [];
      setEntries(rows);
      lastId.current = rows.length ? rows[rows.length - 1].id : undefined;
      setError(null);
    } catch (e) {
      setError(errorText(e));
    } finally {
      busy.current = false;
    }
  }, []);

  useEffect(() => {
    void load(filters);
  }, [filters, load]);

  useEffect(() => {
    if (!auto) return;
    const timer = setInterval(async () => {
      if (busy.current) return;
      busy.current = true;
      try {
        const rows = (await getLogs(query(filters, lastId.current))) ?? [];
        if (rows.length) {
          lastId.current = rows[rows.length - 1].id;
          setEntries((prev) => [...prev, ...rows].slice(-KEEP));
        }
        setError(null);
      } catch (e) {
        setError(errorText(e));
      } finally {
        busy.current = false;
      }
    }, POLL_MS);
    return () => clearInterval(timer);
  }, [auto, filters]);

  const submit = (e: FormEvent) => {
    e.preventDefault();
    setFilters({ ...draft });
  };

  return (
    <Page
      title={S.logsPage}
      actions={
        <button
          type="button"
          role="switch"
          aria-checked={auto}
          onClick={() => setAuto((a) => !a)}
          className="inline-flex min-h-[32px] items-center gap-2 rounded-lg px-2 text-sm font-medium text-fg-2 hover:bg-sunken"
        >
          <span aria-hidden="true" className={`relative inline-block h-[18px] w-[32px] rounded-full transition-colors ${auto ? "bg-accent" : "bg-line-strong"}`}>
            <span className={`absolute top-[2px] h-[14px] w-[14px] rounded-full bg-surface transition-[left] ${auto ? "left-[16px]" : "left-[2px]"}`} />
          </span>
          {L.autoRefresh}
        </button>
      }
    >
      <p className="text-xs text-fg-2">{L.note}</p>
      <form onSubmit={submit} className="flex flex-wrap items-end gap-2">
        <label className="space-y-1">
          <span className="block text-xs font-medium text-fg-2">{L.level}</span>
          <select className="field-sm" value={draft.level} onChange={(e) => setDraft({ ...draft, level: e.target.value })}>
            <option value="">{L.allLevels}</option>
            {LEVELS.map((l) => (
              <option key={l} value={l}>
                {l}
              </option>
            ))}
          </select>
        </label>
        <label className="space-y-1">
          <span className="block text-xs font-medium text-fg-2">{L.logger}</span>
          <input className="field-sm font-mono" value={draft.logger} placeholder="app." onChange={(e) => setDraft({ ...draft, logger: e.target.value })} maxLength={100} />
        </label>
        <label className="min-w-[240px] flex-1 space-y-1">
          <span className="block text-xs font-medium text-fg-2">{L.keyword}</span>
          <input className="field-sm" value={draft.q} onChange={(e) => setDraft({ ...draft, q: e.target.value })} maxLength={200} />
        </label>
        <button type="submit" className="btn-primary btn-sm">
          {L.search}
        </button>
      </form>
      {error && <ErrorState message={error} onRetry={() => void load(filters)} />}
      {entries.length === 0 && !error ? (
        <p className="py-10 text-center text-sm text-fg-2">{L.empty}</p>
      ) : (
        <ol aria-label={L.list} className="panel max-h-[65vh] overflow-auto px-3 py-2 font-mono text-[12px] leading-5">
          {entries.map((e) => (
            <li key={e.id} className="flex gap-3 whitespace-pre-wrap break-all">
              <span className="num shrink-0 text-muted">{formatTime(e.at)}</span>
              <span className={`w-[62px] shrink-0 font-semibold ${levelClass(e.level)}`}>{e.level}</span>
              <span className="w-[160px] shrink-0 truncate text-muted" title={e.logger}>
                {e.logger}
              </span>
              <span className={levelClass(e.level)}>{e.message}</span>
            </li>
          ))}
        </ol>
      )}
    </Page>
  );
}
