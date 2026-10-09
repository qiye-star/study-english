import { Link } from "react-router-dom";
import type { UsageTotals } from "./api";
import { S } from "./strings";

export function money(value: number | null | undefined, currency: string): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return "—";
  try {
    return new Intl.NumberFormat("zh-CN", { style: "currency", currency, maximumFractionDigits: value < 1 ? 4 : 2 }).format(value);
  } catch {
    return `${value.toFixed(2)} ${currency}`;
  }
}

export const percent = (v: number | null | undefined) =>
  v === null || v === undefined || !Number.isFinite(v) ? "—" : `${(v * 100).toFixed(v > 0 && v < 0.001 ? 2 : 1)}%`;

const ms = (v: number | null) => (v === null ? "—" : v >= 1000 ? `${(v / 1000).toFixed(1)} s` : `${v} ms`);

function Kpi({ label, children, note }: { label: string; children: React.ReactNode; note?: React.ReactNode }) {
  return (
    <div className="panel space-y-1 px-4 py-3">
      <p className="text-xs font-medium text-fg-2">{label}</p>
      <div className="num text-xl font-semibold leading-tight">{children}</div>
      {note && <div className="text-xs">{note}</div>}
    </div>
  );
}

/** KPI 行:调用数、错误率、估算费用(标"估算";缺单价时提示并链接设置页单价表)、P50/P95、活跃用户。 */
export function KpiRow({ totals, currency }: { totals: UsageTotals; currency: string }) {
  return (
    <section aria-label={S.usagePage} className="grid grid-cols-5 gap-3">
      <Kpi label={S.kpi.calls}>{totals.calls.toLocaleString("zh-CN")}</Kpi>
      <Kpi label={S.kpi.errorRate} note={<span className="num text-fg-2">{`${totals.errors.toLocaleString("zh-CN")} / ${totals.calls.toLocaleString("zh-CN")}`}</span>}>
        <span className={totals.errorRate >= 0.05 ? "text-bad" : undefined}>{percent(totals.errorRate)}</span>
      </Kpi>
      <Kpi
        label={S.kpi.cost}
        note={
          !totals.costComplete && (
            <span className="text-warn">
              <span>{S.missingPrices}</span>
              {" · "}
              <Link to="/settings/ops" className="underline underline-offset-2">
                {S.missingPricesLink}
              </Link>
            </span>
          )
        }
      >
        <span className="inline-flex items-baseline gap-2">
          <span>{money(totals.cost, currency)}</span>
          <span className="badge bg-sunken text-fg-2">{S.estimate}</span>
        </span>
      </Kpi>
      <Kpi label={S.kpi.latency}>
        <span className="text-base">{`${ms(totals.p50Ms)} / ${ms(totals.p95Ms)}`}</span>
      </Kpi>
      <Kpi label={S.kpi.activeUsers}>{totals.activeUsers.toLocaleString("zh-CN")}</Kpi>
    </section>
  );
}
