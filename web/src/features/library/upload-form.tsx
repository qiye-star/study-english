import { LoaderIcon, TriangleAlertIcon } from "lucide-react";
import { type FormEvent, useState } from "react";
import { useTranslation } from "react-i18next";
import { deriveTitle, formatsHint } from "./add-sheet-helpers";
import { FilePickTile } from "./file-pick-tile";
import { SpecularButton } from "./fx/specular-button";
import {
  LIBRARY_FORMATS, MAX_SUBTITLE_BYTES, MAX_TITLE_CHARS, MIB, SUBTITLE_FORMATS, extOf, type LibraryLimits,
} from "./library-api";
import "./locales";
import { SubtitlePicker } from "./subtitle-picker";
import type { UploadInput } from "./upload-client";

export type UploadProblem = "badType" | "empty" | "tooLarge" | "overQuota" | "subtitleBadType" | "subtitleTooLarge";

const formatsOf = (limits: LibraryLimits): readonly string[] => (limits.formats.length ? limits.formats : LIBRARY_FORMATS);

/** 字幕两条:扩展名、2 MiB 上限(R-A2:从 checkUpload 抽出,先选字幕后选文件时也能立刻提示)。 */
export function checkSubtitles(subtitles: { name: string; size: number }): "subtitleBadType" | "subtitleTooLarge" | null {
  if (!(SUBTITLE_FORMATS as readonly string[]).includes(extOf(subtitles.name))) return "subtitleBadType";
  if (subtitles.size > MAX_SUBTITLE_BYTES) return "subtitleTooLarge";
  return null;
}

/** 客户端预检(R-L19;服务端仍是最终裁判):扩展名、空文件、单文件上限、剩余配额、字幕。 */
export function checkUpload(
  file: { name: string; size: number }, limits: LibraryLimits, subtitles: { name: string; size: number } | null,
): UploadProblem | null {
  if (!formatsOf(limits).includes(extOf(file.name))) return "badType";
  if (file.size <= 0) return "empty";
  if (file.size > limits.maxUploadMb * MIB) return "tooLarge";
  if (limits.usedBytes + file.size > limits.quotaMb * MIB) return "overQuota";
  return subtitles ? checkSubtitles(subtitles) : null;
}

/**
 * 上传页签(spec §11.3):选文件磁贴、可选字幕行、标题(选文件后按文件名自动填写,R-A9);
 * 提交即交给上传任务表,弹层由调用方关闭(R-A10:所以这里只做「提交即禁用」的进行中状态,真实进度在列表卡)。
 */
export function UploadForm({ limits, asr, onSubmit }: { limits: LibraryLimits; asr: boolean; onSubmit: (input: UploadInput) => void }) {
  const { t } = useTranslation();
  const [file, setFile] = useState<File | null>(null);
  const [subs, setSubs] = useState<File | null>(null);
  const [title, setTitle] = useState("");
  const [titleTouched, setTitleTouched] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const formats = formatsOf(limits);
  const mediaProblem = file ? checkUpload(file, limits, null) : null;
  const subsProblem = subs ? checkSubtitles(subs) : null;
  const problem = mediaProblem ?? subsProblem;
  const accept = ["audio/*", "video/*", ...formats.map((f) => `.${f}`)].join(",");

  const pickFile = (next: File | null) => {
    setFile(next);
    if (!titleTouched) setTitle(next ? deriveTitle(next.name) : "");
  };

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!file || problem || submitted) return;
    onSubmit({
      file, filename: file.name, title: title.trim() || undefined,
      subtitles: subs ? { file: subs, filename: subs.name } : null,
    });
    setSubmitted(true);
  };

  return (
    <form onSubmit={submit} className="flex flex-col gap-3" data-testid="library-upload-form" aria-busy={submitted || undefined}>
      <FilePickTile
        file={file}
        onFile={pickFile}
        accept={accept}
        inputTestId="library-upload-file"
        label={t("web.library.upload.file")}
        title={t("web.library.upload.pickTitle")}
        dropLabel={t("web.library.upload.pickDrop")}
        dragHint={t("web.library.upload.pickDrag")}
        replaceLabel={t("web.library.upload.replace")}
        removeLabel={t("web.library.upload.remove")}
        problem={mediaProblem ? t(`web.library.upload.${mediaProblem}`, { mb: limits.maxUploadMb }) : null}
        disabled={submitted}
      >
        <span className="text-meta text-ink-2">{t("web.library.upload.formats", { list: formatsHint(formats) })}</span>
        <span className="text-meta text-ink-3">{t("web.library.upload.limits", { mb: limits.maxUploadMb, minutes: limits.maxDurationMinutes })}</span>
      </FilePickTile>
      <SubtitlePicker
        file={subs}
        onFile={setSubs}
        inputTestId="library-upload-subtitles"
        label={t("web.library.upload.subtitles")}
        addLabel={t("web.library.upload.subtitlesAdd")}
        removeLabel={t("web.library.upload.subtitlesRemove")}
        problem={subsProblem ? t(`web.library.upload.${subsProblem}`) : null}
        disabled={submitted}
      />
      {!asr && !subs ? (
        <div data-testid="library-upload-noasr" className="lib-note lib-note--warn">
          <TriangleAlertIcon aria-hidden />
          <p>{t("web.library.upload.noAsr")}</p>
        </div>
      ) : null}
      <div>
        <label className="lib-ffield">
          <span className="lib-ffield-label">{t("web.library.upload.titleLabel")}</span>
          <input type="text" autoComplete="off" value={title} maxLength={MAX_TITLE_CHARS} className="lib-ffield-input" disabled={submitted}
            onChange={(e) => {
              setTitle(e.target.value);
              setTitleTouched(true);
            }} />
        </label>
        {file && !titleTouched && title ? <p className="mt-1 px-1 text-meta text-ink-3">{t("web.library.upload.titleAuto")}</p> : null}
      </div>
      <SpecularButton type="submit" disabled={!file || !!problem || submitted} className="h-12">
        {submitted ? (
          <>
            <LoaderIcon aria-hidden className="animate-spin motion-reduce:animate-none" />
            {t("web.library.upload.submitting")}
          </>
        ) : t("web.library.upload.submit")}
      </SpecularButton>
    </form>
  );
}
