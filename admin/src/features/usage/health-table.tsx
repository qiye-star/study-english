import { Link } from "react-router-dom";
import { DataTable } from "../../components/data-table";
import { RoleGate } from "../../components/role-gate";
import { StatusDot, type Tone } from "../../components/status-dot";
import { formatRelative } from "../../lib/format";
import type { HealthRow } from "./api";
import { percent } from "./kpi-row";
import { S } from "./strings";

function tone(rate: number | null): Tone {
  if (rate === null) return "neutral";
  if (rate >= 0.95) return "good";
  if (rate >= 0.8) return "warn";
  return "bad";
}

/** 上游健康:最近 15 分钟每个上游的成功率与最近错误码;超级管理员可去配置诊断页"测试连接"。 */
export function HealthTable({ rows }: { rows: HealthRow[] }) {
  return (
    <section className="panel" aria-label={S.health}>
      <div className="panel-head">
        <h2 className="text-sm font-semibold text-fg-2">{S.health}</h2>
        <RoleGate min="superadmin">
          <Link to="/settings" className="btn-ghost btn-sm">
            {S.probe}
          </Link>
        </RoleGate>
      </div>
      <DataTable
        caption={S.health}
        rows={rows}
        rowKey={(r) => `${r.kind}:${r.provider}`}
        empty={S.healthEmpty}
        columns={[
          { key: "upstream", header: S.table.upstream, render: (r) => <span className="font-medium">{r.provider}</span> },
          { key: "kind", header: S.table.kind, render: (r) => S.kinds[r.kind] ?? r.kind },
          { key: "calls", header: S.table.calls, numeric: true, render: (r) => r.calls.toLocaleString("zh-CN") },
          { key: "rate", header: S.table.successRate, numeric: true, render: (r) => <StatusDot tone={tone(r.successRate)} label={percent(r.successRate)} /> },
          {
            key: "last",
            header: S.table.lastError,
            render: (r) => (r.lastErrorStatus === null ? "—" : <span className="num">{`${r.lastErrorStatus === 0 ? S.network : r.lastErrorStatus} · ${formatRelative(r.lastErrorAt)}`}</span>),
          },
        ]}
      />
    </section>
  );
}
