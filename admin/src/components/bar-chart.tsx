export interface BarSeries {
  name: string;
  values: number[];
  /** 一色一义:accent = 主指标、bad = 错误、wave = 中性对比 */
  tone?: "accent" | "good" | "warn" | "bad" | "wave";
}

const FILL: Record<NonNullable<BarSeries["tone"]>, string> = {
  accent: "rgb(var(--accent))",
  good: "rgb(var(--good))",
  warn: "rgb(var(--warn))",
  bad: "rgb(var(--bad))",
  wave: "rgb(var(--wave))",
};

/** 内联 SVG 柱状图(不引入图表库)。stacked = 同一标签下各系列叠加,否则并排。 */
export function BarChart({
  series,
  labels,
  stacked = false,
  height = 160,
  title,
}: {
  series: BarSeries[];
  labels: string[];
  stacked?: boolean;
  height?: number;
  title?: string;
}) {
  const width = 600;
  const pad = { top: 8, bottom: 20, left: 4, right: 4 };
  const n = labels.length;
  const totals = labels.map((_, i) =>
    stacked ? series.reduce((sum, s) => sum + (s.values[i] ?? 0), 0) : Math.max(0, ...series.map((s) => s.values[i] ?? 0)),
  );
  const max = Math.max(1, ...totals);
  const plotH = height - pad.top - pad.bottom;
  const slot = n > 0 ? (width - pad.left - pad.right) / n : 0;
  const barW = stacked ? slot * 0.64 : (slot * 0.72) / Math.max(1, series.length);
  const scale = (v: number) => (v / max) * plotH;
  const every = Math.max(1, Math.ceil(n / 14));

  return (
    <svg viewBox={`0 0 ${width} ${height}`} width="100%" height={height} role="img" aria-label={title} preserveAspectRatio="none">
      <line x1={pad.left} x2={width - pad.right} y1={height - pad.bottom} y2={height - pad.bottom} stroke="rgb(var(--line))" />
      {labels.map((label, i) => {
        const x0 = pad.left + i * slot;
        let stackY = height - pad.bottom;
        return (
          <g key={`${label}-${i}`}>
            {series.map((s, j) => {
              const v = s.values[i] ?? 0;
              const h = scale(v);
              const x = stacked ? x0 + (slot - barW) / 2 : x0 + slot * 0.14 + j * barW;
              const y = stacked ? stackY - h : height - pad.bottom - h;
              if (stacked) stackY -= h;
              return (
                <rect key={s.name} x={x} y={y} width={Math.max(1, barW - 1)} height={h} rx={1.5} fill={FILL[s.tone ?? "accent"]}>
                  <title>{`${label} · ${s.name}: ${v}`}</title>
                </rect>
              );
            })}
            {i % every === 0 && (
              <text x={x0 + slot / 2} y={height - 6} textAnchor="middle" fontSize="10" fill="rgb(var(--fg-2))" style={{ fontVariantNumeric: "tabular-nums" }}>
                {label}
              </text>
            )}
          </g>
        );
      })}
    </svg>
  );
}
