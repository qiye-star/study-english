import { ERROR_BUCKETS, type ErrorBucket } from "./api";
import { percent } from "./kpi-row";
import { S } from "./strings";

/** 错误分解:402 / 429 / 鉴权 / 5xx / 网络 的计数与占比(红 = 错误,只用一种红)。 */
export function ErrorBreakdown({ errors }: { errors: Record<ErrorBucket, number> }) {
  const total = ERROR_BUCKETS.reduce((sum, b) => sum + (errors[b] ?? 0), 0);
  return (
    <section className="panel space-y-3 px-4 py-3" aria-label={S.errors}>
      <h2 className="text-sm font-semibold text-fg-2">{S.errors}</h2>
      {total === 0 ? (
        <p className="text-sm text-fg-2">{S.noErrors}</p>
      ) : (
        <ul className="space-y-2">
          {ERROR_BUCKETS.map((b) => {
            const n = errors[b] ?? 0;
            const share = total ? n / total : 0;
            return (
              <li key={b} className="space-y-1">
                <div className="flex items-baseline justify-between gap-2 text-sm">
                  <span>{S.errorBuckets[b]}</span>
                  <span className="num text-fg-2">{`${n.toLocaleString("zh-CN")} · ${percent(share)}`}</span>
                </div>
                <div className="h-1.5 rounded-full bg-sunken">
                  <div className="h-1.5 rounded-full bg-bad" style={{ width: `${share * 100}%` }} />
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
