import { hasRole, useAdminSession } from "../../api/session";
import { DataTable, type Column } from "../../components/data-table";
import { StatusDot, type Tone } from "../../components/status-dot";
import { formatRelative } from "../../lib/format";
import { ProbeButton } from "../settings";
import type { HealthRow } from "./api";
import { percent } from "./kpi-row";
import { S } from "./strings";

function tone(rate: number | null): Tone {
  if (rate === null) return "neutral";
  if (rate >= 0.95) return "good";
  if (rate >= 0.8) return "warn";
  return "bad";
}

/** 计量的 kind/provider → 测试连接的上游名(server `admin/probes.UPSTREAMS`);null = 无对应探测。 */
export function probeFor(row: Pick<HealthRow, "kind" | "provider">): string | null {
  switch (row.kind) {
    case "llm":
      return "llm";
    case "tts":
      return row.provider === "volcengine" ? "volc_tts" : "tts";
    case "stt":
      return "whisper";
    case "asr_stream":
      return "asr_stream";
    case "assess_azure":
      return "azure";
    case "assess_xfyun":
      return "xfyun";
    default:
      return null;
  }
}

/** 上游健康:最近 15 分钟每个上游的成功率与最近错误码;超级管理员可在行内"测试连接"(真实探测,只显示结果码/状态码/耗时,从不显示密钥)。 */
export function HealthTable({ rows }: { rows: HealthRow[] }) {
  const canProbe = hasRole(useAdminSession(), "superadmin");
  const probeColumn: Column<HealthRow>[] = canProbe
    ? [{ key: "probe", header: S.probe, render: (r) => {
        const upstream = probeFor(r);
        return upstream ? <ProbeButton upstream={upstream} values={{}} /> : "—";
      } }]
    : [];
  return (
    <section className="panel" aria-label={S.health}>
      <div className="panel-head">
        <h2 className="text-sm font-semibold text-fg-2">{S.health}</h2>
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
          ...probeColumn,
        ]}
      />
    </section>
  );
}
