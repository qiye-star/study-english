import { useState } from "react";
import { S } from "./strings";

export interface StackSeries {
  name: string;
  values: number[];
}

/** 同一色相(accent)的明度阶:第一个系列最深,依次变浅(一色一义,不引入新色相)。 */
export function shade(i: number, n: number): number {
  if (n <= 1) return 1;
  return Math.max(0.3, 1 - (i * 0.7) / (n - 1));
}

const W = 600;
const PAD = { top: 8, bottom: 20, left: 4, right: 4 };

/**
 * 内联 SVG 堆叠柱(沿用 activity-chart 的做法):每个 rect 带 <title>(可访问的数值提示),
 * 下方图例;"查看数据表"切换为等价的表格。
 */
export function StackedBars({
  title,
  labels,
  series,
  height = 168,
  format = (v: number) => v.toLocaleString("zh-CN"),
}: {
  title: string;
  labels: string[];
  series: StackSeries[];
  height?: number;
  format?: (v: number) => string;
}) {
  const [table, setTable] = useState(false);
  const n = labels.length;
  const totals = labels.map((_, i) => series.reduce((sum, s) => sum + (s.values[i] ?? 0), 0));
  const max = Math.max(1, ...totals);
  const plotH = height - PAD.top - PAD.bottom;
  const slot = n > 0 ? (W - PAD.left - PAD.right) / n : 0;
  const barW = Math.max(1, Math.min(28, slot * 0.64));
  const every = Math.max(1, Math.ceil(n / 12));

  return (
    <figure className="space-y-2">
      <div className="flex items-center justify-between gap-3">
        <figcaption className="text-sm font-semibold text-fg-2">{title}</figcaption>
        <button type="button" className="btn-quiet btn-sm" aria-pressed={table} onClick={() => setTable((t) => !t)}>
          {table ? S.chartView : S.tableView}
        </button>
      </div>
      {table ? (
        <div className="max-h-72 overflow-auto rounded-lg border border-line">
          <table className="w-full text-sm">
            <caption className="sr-only">{title}</caption>
            <thead className="sticky top-0 bg-sunken text-left text-xs text-fg-2">
              <tr>
                <th scope="col" className="px-3 py-1.5 font-medium">
                  {S.table.day}
                </th>
                {series.map((s) => (
                  <th key={s.name} scope="col" className="px-3 py-1.5 text-right font-medium">
                    {s.name}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {labels.map((label, i) => (
                <tr key={label}>
                  <td className="num px-3 py-1.5">{label}</td>
                  {series.map((s) => (
                    <td key={s.name} className="num px-3 py-1.5 text-right">
                      {format(s.values[i] ?? 0)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <>
          <svg viewBox={`0 0 ${W} ${height}`} width="100%" height={height} role="img" aria-label={title} preserveAspectRatio="none">
            <line x1={PAD.left} x2={W - PAD.right} y1={height - PAD.bottom} y2={height - PAD.bottom} stroke="rgb(var(--line))" />
            {labels.map((label, i) => {
              const x = PAD.left + i * slot + (slot - barW) / 2;
              let top = height - PAD.bottom;
              return (
                <g key={label}>
                  {series.map((s, j) => {
                    const v = s.values[i] ?? 0;
                    const h = (v / max) * plotH;
                    top -= h;
                    return (
                      <rect key={s.name} x={x} y={top} width={barW} height={h} fill="rgb(var(--accent))" fillOpacity={shade(j, series.length)}>
                        <title>{`${label} · ${s.name}:${format(v)}`}</title>
                      </rect>
                    );
                  })}
                  {i % every === 0 && (
                    <text x={x + barW / 2} y={height - 6} textAnchor="middle" fontSize="10" fill="rgb(var(--fg-2))" className="num">
                      {label.slice(5)}
                    </text>
                  )}
                </g>
              );
            })}
          </svg>
          <ul className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-fg-2">
            {series.map((s, j) => (
              <li key={s.name} className="inline-flex items-center gap-1.5">
                <span aria-hidden="true" className="inline-block h-2.5 w-2.5 rounded-sm bg-accent" style={{ opacity: shade(j, series.length) }} />
                {s.name}
              </li>
            ))}
          </ul>
        </>
      )}
    </figure>
  );
}
