/** 服务端接受的范围(UTC-12 .. UTC+14)。 */
const MIN_OFFSET = -720;
const MAX_OFFSET = 840;

/** R23:相对 UTC 往东的分钟数(UTC+8 → 480),夹在服务端范围内,避免 422。 */
export function tzOffsetMinutes(date: Date = new Date()): number {
  const east = -date.getTimezoneOffset();
  if (!Number.isFinite(east)) return 0;
  return Math.min(MAX_OFFSET, Math.max(MIN_OFFSET, Math.round(east))) || 0; // `|| 0` 避免 -0
}

/** 本地日历日 "YYYY-MM-DD"(设备时区,不经 UTC 换算)。 */
export function localDateString(date: Date = new Date()): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${p(date.getMonth() + 1)}-${p(date.getDate())}`;
}
