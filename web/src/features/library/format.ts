const MIB = 1024 * 1024;

/** 字节 → "5.0 MB" / "150 MB" / "2.0 GB"(MiB 计,R-L18)。 */
export function formatBytes(bytes: number): string {
  const mb = Math.max(0, bytes) / MIB;
  if (mb >= 1024) return `${(mb / 1024).toFixed(1)} GB`;
  return mb >= 100 ? `${Math.round(mb)} MB` : `${mb.toFixed(1)} MB`;
}

/** 毫秒 → "m:ss" 或 "h:mm:ss";未知为 "--:--"。 */
export function formatDuration(ms: number | null | undefined): string {
  if (ms === null || ms === undefined || ms < 0) return "--:--";
  const total = Math.floor(ms / 1000);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const pad = (n: number) => String(n).padStart(2, "0");
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`;
}
