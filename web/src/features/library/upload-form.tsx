import { type FormEvent, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  LIBRARY_FORMATS, MAX_SUBTITLE_BYTES, MAX_TITLE_CHARS, MIB, SUBTITLE_FORMATS, extOf, type LibraryLimits,
} from "./library-api";
import "./locales";
import { FIELD, PRIMARY } from "./ui";
import type { UploadInput } from "./upload-client";

export type UploadProblem = "badType" | "empty" | "tooLarge" | "overQuota" | "subtitleBadType" | "subtitleTooLarge";

const formatsOf = (limits: LibraryLimits): readonly string[] => (limits.formats.length ? limits.formats : LIBRARY_FORMATS);

/** 客户端预检(R-L19;服务端仍是最终裁判):扩展名、空文件、单文件上限、剩余配额、字幕。 */
export function checkUpload(
  file: { name: string; size: number }, limits: LibraryLimits, subtitles: { name: string; size: number } | null,
): UploadProblem | null {
  if (!formatsOf(limits).includes(extOf(file.name))) return "badType";
  if (file.size <= 0) return "empty";
  if (file.size > limits.maxUploadMb * MIB) return "tooLarge";
  if (limits.usedBytes + file.size > limits.quotaMb * MIB) return "overQuota";
  if (subtitles) {
    if (!(SUBTITLE_FORMATS as readonly string[]).includes(extOf(subtitles.name))) return "subtitleBadType";
    if (subtitles.size > MAX_SUBTITLE_BYTES) return "subtitleTooLarge";
  }
  return null;
}

/** 上传页签(spec §11.3):文件、可选字幕、可选标题;提交即交给上传任务表,弹层由调用方关闭。 */
export function UploadForm({ limits, asr, onSubmit }: { limits: LibraryLimits; asr: boolean; onSubmit: (input: UploadInput) => void }) {
  const { t } = useTranslation();
  const [file, setFile] = useState<File | null>(null);
  const [subs, setSubs] = useState<File | null>(null);
  const [title, setTitle] = useState("");
  const problem = file ? checkUpload(file, limits, subs) : null;
  const accept = ["audio/*", "video/*", ...formatsOf(limits).map((f) => `.${f}`)].join(",");

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!file || problem) return;
    onSubmit({
      file, filename: file.name, title: title.trim() || undefined,
      subtitles: subs ? { file: subs, filename: subs.name } : null,
    });
  };

  return (
    <form onSubmit={submit} className="flex flex-col gap-3" data-testid="library-upload-form">
      <label className="flex flex-col gap-1.5">
        <span className="eyebrow">{t("web.library.upload.file")}</span>
        <input type="file" accept={accept} data-testid="library-upload-file" className="min-h-tap text-sub text-ink"
          onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
      </label>
      <p className="text-meta text-ink-2">{t("web.library.upload.limits", { mb: limits.maxUploadMb, minutes: limits.maxDurationMinutes })}</p>
      <label className="flex flex-col gap-1.5">
        <span className="eyebrow">{t("web.library.upload.subtitles")}</span>
        <input type="file" accept=".srt,.vtt" data-testid="library-upload-subtitles" className="min-h-tap text-sub text-ink"
          onChange={(e) => setSubs(e.target.files?.[0] ?? null)} />
      </label>
      {!asr && !subs ? <p data-testid="library-upload-noasr" className="text-meta text-amber">{t("web.library.upload.noAsr")}</p> : null}
      <label className="flex flex-col gap-1.5">
        <span className="eyebrow">{t("web.library.upload.titleLabel")}</span>
        <input type="text" value={title} maxLength={MAX_TITLE_CHARS} className={FIELD} onChange={(e) => setTitle(e.target.value)} />
      </label>
      {problem ? <p role="alert" className="text-meta text-red">{t(`web.library.upload.${problem}`, { mb: limits.maxUploadMb })}</p> : null}
      <button type="submit" disabled={!file || !!problem} className={`${PRIMARY} h-12`}>{t("web.library.upload.submit")}</button>
    </form>
  );
}
