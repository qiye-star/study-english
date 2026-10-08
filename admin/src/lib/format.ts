export function formatBytes(bytes: number | null | undefined): string {
  const n = Number(bytes);
  if (!Number.isFinite(n) || n <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  let i = 0;
  let v = n;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i++;
  }
  const digits = i === 0 || v >= 100 ? 0 : v >= 10 ? 1 : 2;
  return `${v.toFixed(digits)} ${units[i]}`;
}

const pad = (n: number) => String(n).padStart(2, "0");

export function formatDateTime(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function formatTime(iso: string | null | undefined): string {
  if (!iso) return "";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "" : `${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function formatRelative(iso: string | null | undefined, now: number = Date.now()): string {
  if (!iso) return "从未";
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return "—";
  const min = Math.floor(Math.max(0, now - t) / 60_000);
  if (min < 1) return "刚刚";
  if (min < 60) return `${min} 分钟前`;
  const hours = Math.floor(min / 60);
  if (hours < 24) return `${hours} 小时前`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days} 天前`;
  return formatDateTime(iso).slice(0, 10);
}

/** 毫秒 -> m:ss */
export function formatDuration(ms: number | null | undefined): string {
  return formatSeconds((Number(ms) || 0) / 1000);
}

export function formatSeconds(sec: number): string {
  const total = Math.round(Math.max(0, sec || 0));
  return `${Math.floor(total / 60)}:${pad(total % 60)}`;
}

export type Tone = "good" | "warn" | "bad" | "none";

export function scoreTone(score: number | null | undefined): Tone {
  if (score === null || score === undefined || !Number.isFinite(score)) return "none";
  if (score >= 80) return "good";
  if (score >= 60) return "warn";
  return "bad";
}

export const TONE_TEXT: Record<Tone, string> = { good: "text-good", warn: "text-warn", bad: "text-bad", none: "text-muted" };
export const TONE_SOFT: Record<Tone, string> = {
  good: "bg-good-soft text-good",
  warn: "bg-warn-soft text-warn",
  bad: "bg-bad-soft text-bad",
  none: "bg-sunken text-muted",
};
export const TONE_BAR: Record<Tone, string> = { good: "bg-good", warn: "bg-warn", bad: "bg-bad", none: "bg-muted" };

export function formatScore(score: number | null | undefined): string {
  return score === null || score === undefined || !Number.isFinite(score) ? "—" : String(Math.round(score));
}

/** 大数字紧凑显示(zh-CN):≥ 1 亿用「亿」,≥ 1 万用「万」,其余千分位。完整值放 title。 */
export function formatCompact(n: number): string {
  const v = Number(n);
  if (!Number.isFinite(v)) return "—";
  const abs = Math.abs(v);
  if (abs >= 1e8) return `${trimZero((v / 1e8).toFixed(abs >= 1e9 ? 0 : 1))}亿`;
  if (abs >= 1e4) return `${trimZero((v / 1e4).toFixed(abs >= 1e5 ? 0 : 1))}万`;
  return v.toLocaleString("zh-CN");
}
const trimZero = (s: string) => s.replace(/\.0$/, "");
