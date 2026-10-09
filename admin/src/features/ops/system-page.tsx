import type { ReactNode } from "react";
import { Page } from "../../components/layout";
import { ErrorState, Skeleton } from "../../components/states";
import { StatusDot, type Tone } from "../../components/status-dot";
import { useAsync } from "../../hooks/use-async";
import { formatBytes, formatDateTime } from "../../lib/format";
import { getSystem, type SystemStatus, type TaskName } from "./api";
import { S } from "./strings";

const T = S.system;

function Card({ title, children, tone, alert }: { title: string; children: ReactNode; tone?: Tone; alert?: ReactNode }) {
  return (
    <section className="panel" aria-label={title}>
      <div className="panel-head">
        <h2 className="text-sm font-semibold text-fg-2">{title}</h2>
        {tone && tone !== "good" && <StatusDot tone={tone} />}
      </div>
      {alert && <div className="px-4 pb-1">{alert}</div>}
      <dl className="divide-y divide-line px-4 pb-2">{children}</dl>
    </section>
  );
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-3 py-2 text-sm">
      <dt className="text-fg-2">{label}</dt>
      <dd className="num min-w-0 truncate text-right">{children}</dd>
    </div>
  );
}

function Alert({ tone, children }: { tone: "warn" | "bad"; children: ReactNode }) {
  return (
    <p role="status" className={`rounded-lg px-3 py-2 text-sm font-medium ${tone === "warn" ? "bg-warn-soft text-warn" : "bg-bad-soft text-bad"}`}>
      {children}
    </p>
  );
}

const TASKS: TaskName[] = ["watcher", "metering", "rooms_sweeper", "backups"];

function taskTone(state: boolean | null): Tone {
  return state === null ? "neutral" : state ? "good" : "bad";
}

function Body({ s }: { s: SystemStatus }) {
  const notMigrated = !!s.db.alembicCurrent && !!s.db.alembicHead && s.db.alembicCurrent !== s.db.alembicHead;
  const lowDisk = !!s.disk.total && s.disk.free !== null && s.disk.free / s.disk.total < 0.1;
  const stopped = TASKS.filter((t) => s.tasks[t] === false);
  const settingsWarn = s.settings.safeMode || s.settings.pendingRestart.length > 0 || Object.keys(s.settings.invalid).length > 0;
  return (
    <>
      <p className="text-sm text-fg-2">
        <StatusDot tone={s.findings.error ? "bad" : s.findings.warn ? "warn" : "good"} label={T.findings(s.findings.error, s.findings.warn)} />
      </p>
      <div className="grid grid-cols-3 gap-3">
        <Card title={T.runtime}>
          <Row label={T.version}>{s.version}</Row>
          <Row label={T.build}>{s.buildSha || S.none}</Row>
          <Row label={T.python}>{s.python}</Row>
          <Row label={T.startedAt}>{formatDateTime(s.startedAt)}</Row>
          <Row label={T.uptime}>{T.uptimeText(s.uptimeSeconds)}</Row>
          <Row label={T.workers}>{s.workers}</Row>
        </Card>
        <Card title={T.database} tone={notMigrated ? "warn" : undefined} alert={notMigrated && <Alert tone="warn">{T.notMigrated}</Alert>}>
          <Row label={T.backend}>{s.db.backend}</Row>
          <Row label={T.dbSize}>{s.db.sizeBytes === null ? S.none : formatBytes(s.db.sizeBytes)}</Row>
          <Row label={T.alembic}>{`${s.db.alembicCurrent ?? S.none} / ${s.db.alembicHead ?? S.none}`}</Row>
        </Card>
        <Card title={T.disk} tone={lowDisk ? "warn" : undefined} alert={lowDisk && <Alert tone="warn">{T.lowDisk}</Alert>}>
          <Row label={T.diskTotal}>{s.disk.total === null ? S.none : `${formatBytes(s.disk.used)} / ${formatBytes(s.disk.total)}`}</Row>
          <Row label={T.diskFree}>{s.disk.free === null ? S.none : formatBytes(s.disk.free)}</Row>
          <Row label={T.recordings}>{formatBytes(s.recordingsBytes)}</Row>
        </Card>
        <Card title={T.live}>
          <Row label={T.realtime}>{s.realtimeActive}</Row>
          <Row label={T.rooms}>{s.roomsConnections}</Row>
          <Row label={T.meter}>
            <span className={s.meter.dropped ? "text-warn" : undefined}>{`${s.meter.depth} / ${s.meter.dropped}`}</span>
          </Row>
        </Card>
        <Card title={T.tasks} tone={stopped.length ? "bad" : undefined}>
          {TASKS.map((t) => {
            const state = s.tasks[t] ?? null;
            const label = state === null ? T.taskState.idle : state ? T.taskState.running : T.taskState.stopped;
            return (
              <Row key={t} label={T.taskNames[t]}>
                <StatusDot tone={taskTone(state)} label={label} />
              </Row>
            );
          })}
        </Card>
        <Card title={T.settings} tone={settingsWarn ? "warn" : undefined}>
          <Row label={T.revision}>{s.settings.revision}</Row>
          <Row label={T.safeMode}>{s.settings.safeMode ? <span className="text-bad">{T.on}</span> : T.off}</Row>
          <Row label={T.pendingRestart}>
            {s.settings.pendingRestart.length ? <span className="text-warn">{s.settings.pendingRestart.join(", ")}</span> : S.none}
          </Row>
          <Row label={T.invalid}>
            {Object.keys(s.settings.invalid).length ? <span className="text-warn">{Object.keys(s.settings.invalid).join(", ")}</span> : S.none}
          </Row>
          {s.settings.loadError && <Row label={T.loadError}><span className="text-bad">{s.settings.loadError}</span></Row>}
        </Card>
      </div>
    </>
  );
}

/** 系统状态(viewer):分组卡片;迁移落后/磁盘不足为琥珀,后台任务停止为红点。 */
export function SystemPage() {
  const state = useAsync(() => getSystem(), []);
  return (
    <Page
      title={S.systemPage}
      actions={
        <button type="button" className="btn-ghost btn-sm" onClick={state.reload}>
          {S.refresh}
        </button>
      }
    >
      {state.loading && !state.data ? (
        <Skeleton variant="blocks" rows={3} />
      ) : state.error ? (
        <ErrorState message={state.error} onRetry={state.reload} />
      ) : state.data ? (
        <Body s={state.data} />
      ) : null}
    </Page>
  );
}
