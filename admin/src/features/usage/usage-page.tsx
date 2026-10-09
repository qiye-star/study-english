import { useState } from "react";
import { Page } from "../../components/layout";
import { ErrorState, Skeleton } from "../../components/states";
import { useAsync } from "../../hooks/use-async";
import { getHealth, getSummary, getTopUsers, USAGE_DAYS, type DailyRow, type UsageDays, type UsageSummary } from "./api";
import { ErrorBreakdown } from "./error-breakdown";
import { HealthTable } from "./health-table";
import { KpiRow, money } from "./kpi-row";
import { shade, StackedBars } from "./stacked-bars";
import { S } from "./strings";
import { TopUsers } from "./top-users";

function RangePicker({ value, onChange }: { value: UsageDays; onChange: (d: UsageDays) => void }) {
  return (
    <div role="radiogroup" aria-label={S.range} className="flex gap-0.5 rounded-lg bg-sunken p-0.5">
      {USAGE_DAYS.map((d) => (
        <button
          key={d}
          type="button"
          role="radio"
          aria-checked={d === value}
          onClick={() => onChange(d)}
          className={`num min-h-[32px] min-w-[52px] rounded-[7px] px-2 text-xs font-medium transition-colors ${d === value ? "bg-surface text-fg shadow-card" : "text-muted hover:text-fg-2"}`}
        >
          {S.days(d)}
        </button>
      ))}
    </div>
  );
}

/** 横向条:单一系列用 accent,条目之间只用同一色的明度阶区分。 */
function HBars({ title, rows, currency }: { title: string; rows: { key: string; label: string; calls: number; cost: number | null }[]; currency: string }) {
  const max = Math.max(1, ...rows.map((r) => r.calls));
  return (
    <section className="panel space-y-2 px-4 py-3" aria-label={title}>
      <h2 className="text-sm font-semibold text-fg-2">{title}</h2>
      {rows.length === 0 ? (
        <p className="text-sm text-fg-2">{S.empty}</p>
      ) : (
        <ul className="space-y-2">
          {rows.map((r, i) => (
            <li key={r.key} className="space-y-1">
              <div className="flex items-baseline justify-between gap-2 text-sm">
                <span className="min-w-0 truncate" title={r.label}>
                  {r.label}
                </span>
                <span className="num shrink-0 text-fg-2">{`${r.calls.toLocaleString("zh-CN")} · ${money(r.cost, currency)}`}</span>
              </div>
              <div className="h-2 rounded-full bg-sunken">
                <div className="h-2 rounded-full bg-accent" style={{ width: `${(r.calls / max) * 100}%`, opacity: shade(i, rows.length) }} />
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

/** 按日估算费用:单独的小折线(不与调用数共用双轴)。 */
function CostTrend({ daily, currency }: { daily: DailyRow[]; currency: string }) {
  const W = 600;
  const H = 96;
  const pad = 10;
  const values = daily.map((d) => d.cost ?? 0);
  const max = Math.max(1e-9, ...values);
  const step = daily.length > 1 ? (W - 2 * pad) / (daily.length - 1) : 0;
  const pts = values.map((v, i) => [daily.length > 1 ? pad + i * step : W / 2, H - pad - (v / max) * (H - 2 * pad)] as const);
  return (
    <figure className="space-y-2">
      <figcaption className="text-sm font-semibold text-fg-2">{S.costTrend}</figcaption>
      <svg viewBox={`0 0 ${W} ${H}`} width="100%" height={H} role="img" aria-label={S.costTrend} preserveAspectRatio="none">
        <line x1={pad} x2={W - pad} y1={H - pad} y2={H - pad} stroke="rgb(var(--line))" />
        {pts.length > 1 && (
          <polyline points={pts.map(([x, y]) => `${x},${y}`).join(" ")} fill="none" stroke="rgb(var(--accent))" strokeWidth="1.5" strokeDasharray="4 3" />
        )}
        {pts.map(([x, y], i) => (
          <circle key={daily[i].day} cx={x} cy={y} r={2.5} fill="rgb(var(--accent))">
            <title>{`${daily[i].day}:${money(daily[i].cost, currency)}`}</title>
          </circle>
        ))}
      </svg>
    </figure>
  );
}

function Dashboard({ data }: { data: UsageSummary }) {
  const features = Array.from(new Set(data.daily.flatMap((d) => Object.keys(d.features))));
  const order = data.byFeature.map((f) => f.feature).filter((f) => features.includes(f));
  const stackOrder = [...order, ...features.filter((f) => !order.includes(f))];
  return (
    <>
      <KpiRow totals={data.totals} currency={data.currency} />
      <section className="panel grid grid-cols-[2fr_1fr] gap-6 px-4 py-3">
        <StackedBars
          title={S.trend}
          labels={data.daily.map((d) => d.day)}
          series={stackOrder.map((f) => ({ name: S.features[f] ?? f, values: data.daily.map((d) => d.features[f] ?? 0) }))}
        />
        <CostTrend daily={data.daily} currency={data.currency} />
      </section>
      <div className="grid grid-cols-3 gap-3">
        <HBars
          title={S.byFeature}
          currency={data.currency}
          rows={data.byFeature.map((f) => ({ key: f.feature, label: S.features[f.feature] ?? f.feature, calls: f.calls, cost: f.cost }))}
        />
        <HBars
          title={S.byModel}
          currency={data.currency}
          rows={data.byModel.map((m) => ({
            key: `${m.kind}:${m.provider}:${m.model}:${m.unit}`,
            label: `${S.kinds[m.kind] ?? m.kind} · ${m.provider} / ${m.model}`,
            calls: m.calls,
            cost: m.cost,
          }))}
        />
        <ErrorBreakdown errors={data.errors} />
      </div>
    </>
  );
}

/** 用量与估算费用仪表盘(视觉稿第 4 屏)。所有金额都标"估算"。 */
export function UsagePage() {
  const [days, setDays] = useState<UsageDays>(7);
  const [by, setBy] = useState<"cost" | "calls">("cost");
  const summary = useAsync(() => getSummary(days), [days]);
  const top = useAsync(() => getTopUsers(days, by), [days, by]);
  const health = useAsync(() => getHealth(), []);
  const currency = summary.data?.currency ?? "CNY";

  return (
    <Page title={S.usagePage} actions={<RangePicker value={days} onChange={setDays} />}>
      {summary.loading && !summary.data ? (
        <Skeleton variant="blocks" rows={3} />
      ) : summary.error ? (
        <ErrorState message={summary.error} onRetry={summary.reload} />
      ) : summary.data ? (
        <Dashboard data={summary.data} />
      ) : null}
      <div className="grid grid-cols-2 gap-3">
        {top.error ? <ErrorState message={top.error} onRetry={top.reload} /> : <TopUsers users={top.data ?? []} currency={currency} by={by} onByChange={setBy} />}
        {health.error ? <ErrorState message={health.error} onRetry={health.reload} /> : <HealthTable rows={health.data ?? []} />}
      </div>
    </Page>
  );
}
