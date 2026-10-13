import { formatBytes } from "./format";
import { MAX_TITLE_CHARS, MIB, extOf, stemOf } from "./library-api";

const KIB = 1024;

/** 选中文件卡上的大小:不足 1 KiB 用 B,不足 1 MiB 用 KB,其余沿用 `formatBytes`(MiB 计,R-L18)。 */
export function formatFileSize(bytes: number): string {
  const n = Math.max(0, bytes);
  if (n < KIB) return `${Math.round(n)} B`;
  if (n < MIB) {
    const kb = n / KIB;
    return kb >= 100 ? `${Math.round(kb)} KB` : `${kb.toFixed(1)} KB`;
  }
  return formatBytes(n);
}

/** 磁贴上的格式提示:「mp4 · mov · mkv +9」,最多列 `max` 个。 */
export function formatsHint(formats: readonly string[], max = 6): string {
  const list = formats.map((f) => f.toLowerCase());
  if (list.length <= max) return list.join(" · ");
  return `${list.slice(0, max).join(" · ")} +${list.length - max}`;
}

export type FileKind = "video" | "audio" | "other";

const VIDEO_EXT = new Set(["mp4", "m4v", "mov", "webm", "mkv"]);
const AUDIO_EXT = new Set(["mp3", "m4a", "aac", "wav", "ogg", "opus", "flac"]);

/** 文件卡的图标类型:先看扩展名(白名单),再看 MIME。 */
export function fileKind(file: { name: string; type?: string }): FileKind {
  const ext = extOf(file.name);
  if (VIDEO_EXT.has(ext)) return "video";
  if (AUDIO_EXT.has(ext)) return "audio";
  if (file.type?.startsWith("video/")) return "video";
  if (file.type?.startsWith("audio/")) return "audio";
  return "other";
}

/**
 * 选文件后自动填进标题框的名字:文件名主干(`stemOf`,与服务端默认标题同规则);
 * 下划线换空格;名字里没有空格时(「Friends.S01E02.720p」这类)点号也换空格。
 */
export function deriveTitle(filename: string): string {
  const stem = stemOf(filename);
  let title = stem.replace(/_+/g, " ");
  if (!/\s/.test(title)) title = title.replace(/\./g, " ");
  title = title.replace(/\s+/g, " ").trim();
  return (title || stem).slice(0, MAX_TITLE_CHARS);
}
