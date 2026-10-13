/** 处理失败的种类(spec §6.6;英文常量由服务端存在 error_kind)。网页只显示本地化原因,从不显示上游文本。 */
export const ERROR_KINDS = [
  "too_large", "too_long", "quota", "corrupt", "no_audio", "bad_subtitle", "no_subtitles", "disk_full", "unsupported_format",
  "upload_expired", "link_disabled", "bad_url", "drm", "private", "geo_blocked", "login_required", "blocked",
  "playlist_unsupported", "live_unsupported", "unsupported_site", "ytdlp_failed", "upstream", "network", "ytdlp_transient",
] as const;
export type ErrorKind = (typeof ERROR_KINDS)[number];

/** 重试必然再失败的种类(R-L12)。 */
const NO_RETRY: ReadonlySet<string> = new Set([
  "too_large", "too_long", "corrupt", "no_audio", "bad_subtitle", "no_subtitles", "unsupported_format", "upload_expired",
  "link_disabled", "bad_url", "drm", "private", "playlist_unsupported", "live_unsupported", "unsupported_site",
]);
const NEEDS_SUBTITLES: ReadonlySet<string> = new Set(["no_subtitles", "bad_subtitle"]);

export function isErrorKind(kind: unknown): kind is ErrorKind {
  return typeof kind === "string" && (ERROR_KINDS as readonly string[]).includes(kind);
}

export function errorKindKey(kind: string | null | undefined): string {
  return `web.library.errors.kind.${isErrorKind(kind) ? kind : "unknown"}`;
}

/** 失败卡上的动作:「重试」与「补传字幕」(「删除」总是有)。 */
export function failedActions(kind: string | null | undefined): { retry: boolean; subtitles: boolean } {
  const k = kind ?? "";
  return { retry: !NO_RETRY.has(k), subtitles: NEEDS_SUBTITLES.has(k) };
}
