import { useEffect, useRef, useState, type PointerEvent } from "react";
import type { DailyPoint } from "../api/types";
import { S } from "../strings";
import { Segmented } from "./layout";

type Metric = "messages" | "assessments" | "new_users";
const METRICS = Object.keys(S.overview.metrics) as Metric[];

const H = 140;
const PAD_TOP = 8;
const PAD_BOTTOM = 22;
const AXIS_W = 28;

function useWidth<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  const [width, setWidth] = useState(0);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const update = () => setWidth(el.clientWidth);
    update();
    const RO = typeof ResizeObserver !== "undefined" ? new ResizeObserver(update) : null;
    RO?.observe(el);
    window.addEventListener("resize", update);
    return () => {
      RO?.disconnect();
      window.removeEventListener("resize", update);
    };
  }, []);
  return { ref, width };
}

/** 刻度上限取到"整齐"的数:1/2/5 × 10^n */
function niceMax(v: number): number {
  if (v <= 0) return 1;
  const p = Math.pow(10, Math.floor(Math.log10(v)));
  for (const m of [1, 2, 5, 10]) if (m * p >= v) return m * p;
  return 10 * p;
}

const short = (d: string) => d.slice(5).replace("-", "/");

/**
 * 近期活跃柱状图:SVG 按容器宽度绘制,单序列、accent 着色;点按或滑动查看某天;
 * 顶部大数字是当前窗口合计(或选中日期的值);附带表格视图。
 */
export function ActivityChart({ daily, days, onDaysChange }: { daily: DailyPoint[]; days: number; onDaysChange: (d: number) => void }) {
  const [metric, setMetric] = useState<Metric>("messages");
  const [picked, setPicked] = useState<number | null>(null);
  const { ref, width } = useWidth<HTMLDivElement>();

  const values = daily.map((d) => d[metric]);
  const total = values.reduce((a, b) => a + b, 0);
  const rawMax = Math.max(0, ...values);
  const yMax = niceMax(rawMax);
  const peakIdx = values.indexOf(rawMax);
  const idx = picked !== null && picked < daily.length ? picked : null;
  const shown = idx !== null ? daily[idx] : null;
  const avg = daily.length ? total / daily.length : 0;

  const plotW = Math.max(0, width - AXIS_W);
  const n = Math.max(1, daily.length);
  const slot = plotW / n;
  const gap = slot >= 6 ? 2 : 1;
  const barW = Math.min(24, Math.max(1, slot - gap));
  const plotH = H - PAD_TOP - PAD_BOTTOM;
  const y = (v: number) => PAD_TOP + plotH - (v / yMax) * plotH;

  const pickFromPointer = (e: PointerEvent<SVGSVGElement>) => {
    if (daily.length === 0 || slot === 0) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const i = Math.floor((e.clientX - rect.left - AXIS_W) / slot);
    if (i >= 0 && i < daily.length) setPicked(i);
  };

  // x 轴标签:7 天全标,更长只标首/中/尾
  const labelIdx = daily.length <= 8 ? daily.map((_, i) => i) : [0, Math.floor((daily.length - 1) / 2), daily.length - 1];
  const fmt = (v: number) => v.toLocaleString("zh-CN");

  return (
    <section className="panel" aria-label={S.overview.activity}>
      <div className="panel-head">
        <h2 className="text-sm font-semibold text-fg-2">{S.overview.activity}</h2>
        <div role="group" aria-label={S.overview.range} className="flex gap-0.5 rounded-lg bg-sunken p-0.5">
          {[7, 30, 90].map((d) => (
            <button
              key={d}
              type="button"
              aria-pressed={d === days}
              onClick={() => {
                onDaysChange(d);
                setPicked(null);
              }}
              className={`num min-h-[32px] min-w-[44px] rounded-[7px] px-2 text-xs font-medium transition-colors ${d === days ? "bg-surface text-fg shadow-card" : "text-muted hover:text-fg-2"}`}
            >
              {S.overview.days(d)}
            </button>
          ))}
        </div>
      </div>

      <div className="space-y-3 px-4 pb-4 pt-2">
        <div className="flex items-end justify-between gap-3">
          <div className="min-w-0">
            <p className="eyebrow num normal-case tracking-normal">{shown ? shown.date : S.overview.windowTotal(days)}</p>
            <p className="num text-2xl font-semibold leading-none" aria-live="polite">
              {fmt(shown ? shown[metric] : total)}
            </p>
          </div>
          {!shown && daily.length > 0 && (
            <dl className="flex shrink-0 gap-4 text-right">
              <div>
                <dt className="eyebrow">{S.overview.dailyAvg}</dt>
                <dd className="num text-sm font-medium">{avg >= 10 ? Math.round(avg).toLocaleString("zh-CN") : avg.toFixed(1)}</dd>
              </div>
              <div>
                <dt className="eyebrow">{S.overview.peak}</dt>
                <dd className="num text-sm font-medium">{fmt(rawMax)}</dd>
              </div>
            </dl>
          )}
        </div>

        <Segmented
          size="sm"
          label={S.overview.metric}
          value={metric}
          onChange={(m) => {
            setMetric(m);
            setPicked(null);
          }}
          options={METRICS.map((m) => ({ value: m, label: S.overview.metrics[m] }))}
        />

        <div ref={ref} className="w-full">
          {width > 0 && (
            <svg
              width={width}
              height={H}
              role="img"
              aria-label={`${S.overview.metrics[metric]}:${S.overview.windowTotal(days)} ${fmt(total)}`}
              className="block touch-none select-none"
              onPointerDown={pickFromPointer}
              onPointerMove={(e) => e.buttons > 0 && pickFromPointer(e)}
              onPointerLeave={() => undefined}
            >
              {/* 网格:0 / 中 / 顶,细线 */}
              {[0, 0.5, 1].map((t) => (
                <g key={t}>
                  <line x1={AXIS_W} x2={width} y1={y(yMax * t)} y2={y(yMax * t)} stroke="rgb(var(--line))" strokeWidth="1" shapeRendering="crispEdges" />
                  <text x={AXIS_W - 6} y={y(yMax * t) + 3.5} textAnchor="end" fontSize="10" fill="rgb(var(--muted))" className="num">
                    {fmt(yMax * t)}
                  </text>
                </g>
              ))}
              {daily.map((d, i) => {
                const v = d[metric];
                const x = AXIS_W + i * slot + (slot - barW) / 2;
                const h = v > 0 ? Math.max(2, (v / yMax) * plotH) : 0;
                const selected = i === idx;
                const r = Math.min(3, barW / 2);
                return (
                  <g key={d.date}>
                    {v > 0 ? (
                      <path
                        d={`M${x},${y(0)} v${-(h - r)} a${r},${r} 0 0 1 ${r},${-r} h${barW - 2 * r} a${r},${r} 0 0 1 ${r},${r} v${h - r} z`}
                        fill="rgb(var(--accent))"
                        opacity={idx === null ? (i === peakIdx ? 1 : 0.72) : selected ? 1 : 0.35}
                      />
                    ) : (
                      <rect x={x} y={y(0) - 1.5} width={barW} height={1.5} fill="rgb(var(--line-strong))" />
                    )}
                    {selected && <line x1={x + barW / 2} x2={x + barW / 2} y1={PAD_TOP} y2={y(0)} stroke="rgb(var(--fg))" strokeOpacity="0.35" strokeWidth="1" strokeDasharray="2 3" />}
                  </g>
                );
              })}
              {labelIdx.map((i) => {
                const d = daily[i];
                if (!d) return null;
                const cx = AXIS_W + i * slot + slot / 2;
                const anchor = daily.length > 8 ? (i === 0 ? "start" : i === daily.length - 1 ? "end" : "middle") : "middle";
                const tx = daily.length > 8 ? (i === 0 ? AXIS_W : i === daily.length - 1 ? width : cx) : cx;
                return (
                  <text key={i} x={tx} y={H - 6} textAnchor={anchor} fontSize="10" fill="rgb(var(--muted))" className="num">
                    {short(d.date)}
                  </text>
                );
              })}
            </svg>
          )}
        </div>

        <details className="group">
          <summary className="flex min-h-[36px] cursor-pointer select-none items-center text-xs font-medium text-muted hover:text-fg-2">
            {S.common.tableView}
            <span aria-hidden="true" className="ml-1 transition-transform group-open:rotate-180">
              ⌄
            </span>
          </summary>
          <div className="mt-1 max-h-64 overflow-auto rounded-lg border border-line">
            <table className="w-full text-sm">
              <thead className="sticky top-0 bg-sunken text-left text-xs text-muted">
                <tr>
                  <th className="px-3 py-1.5 font-medium">{S.common.date}</th>
                  <th className="px-3 py-1.5 text-right font-medium">{S.overview.metrics[metric]}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {daily.map((d) => (
                  <tr key={d.date}>
                    <td className="num px-3 py-1.5">{d.date}</td>
                    <td className="num px-3 py-1.5 text-right">{fmt(d[metric])}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </details>
      </div>
    </section>
  );
}
