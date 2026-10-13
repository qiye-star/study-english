import { ChevronRightIcon, ClapperboardIcon, FileTextIcon, MusicIcon, RotateCcwIcon, Trash2Icon, UploadIcon, XIcon } from "lucide-react";
import { type CSSProperties, type ReactNode, useRef } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";
import { cn } from "@renderer/lib/utils";
import { translateServerError } from "~/api/error-messages";
import { IconButton } from "~/components/icon-button";
import { ToneBadge } from "~/components/tone-badge";
import { errorKindKey, failedActions } from "./error-kinds";
import { ShinyText } from "./fx/shiny-text";
import { SpotlightCard } from "./fx/spotlight-card";
import { Stepper, type StepperStep } from "./fx/stepper";
import { formatBytes, formatDuration } from "./format";
import { LIBRARY_SERVER_ERRORS, type LibraryItem, type LibrarySource } from "./library-api";
import "./locales";
import { TEXT_BUTTON } from "./ui";
import type { UploadJob } from "./upload-store";
import { usePosterUrl } from "./use-poster";

export interface ItemCardHandlers {
  onDelete(item: LibraryItem): void;
  onRetry(item: LibraryItem): void;
  onAddSubtitles(item: LibraryItem): void;
  onResumeUpload(item: LibraryItem): void;
  onCancelUpload(job: UploadJob): void;
  onRetryUpload(job: UploadJob): void;
  onDismissUpload(job: UploadJob): void;
}

/** 处理阶段的步骤(spec §6.2):上传类没有「取回」,链接有。 */
export const UPLOAD_STAGES = ["probe", "transcode", "subtitles", "transcribe", "segment"] as const;
export const LINK_STAGES = ["probe", "fetch", "transcode", "subtitles", "transcribe", "segment"] as const;
export const stagesFor = (source: LibrarySource): readonly string[] => (source === "link" ? LINK_STAGES : UPLOAD_STAGES);

const clampPct = (pct: number) => Math.max(0, Math.min(100, Math.round(pct)));

/** 上传进度条:沿用「已用空间」条的样式(.lib-quota-bar / .lib-quota-fill,用 transform: scaleX,不动布局)。 */
function ProgressBar({ pct, label }: { pct: number; label: string }) {
  const value = clampPct(pct);
  return (
    <div role="progressbar" aria-label={label} aria-valuemin={0} aria-valuemax={100} aria-valuenow={value} className="lib-quota-bar mt-2.5">
      <div className="lib-quota-fill" style={{ "--p": value / 100 } as CSSProperties} />
    </div>
  );
}

/**
 * 跟读库列表的一张卡(spec §11.2、§11.4a):ready 整行是链接;处理中显示流光状态行 + 阶段步骤条;失败显示原因与可用动作(R-L12);
 * 本地上传任务(job)优先于服务端状态显示。卡片是 SpotlightCard(按住高光、半透明 + 高光边、不加模糊)并依次浮入(`index` 决定延迟,最多 8 档)。
 * 颜色:蓝 = 进行中 / 操作,原因用中性次要色。
 */
export function ItemCard({ item, job, index = 0, ...h }: { item: LibraryItem | null; job?: UploadJob; index?: number } & ItemCardHandlers) {
  const { t } = useTranslation();
  const ref = useRef<HTMLLIElement>(null);
  const ready = item?.status === "ready";
  const poster = usePosterUrl(item?.id ?? "", !!item && ready && item.kind === "video", ref);
  const title = item?.title ?? job?.title ?? "";
  const state = job ? (job.state === "uploading" ? "upload-local" : "upload-failed") : (item?.status ?? "uploading");
  const meta = item
    ? [
      item.durationMs ? formatDuration(item.durationMs) : null,
      ready ? t("web.library.sentences", { count: item.segCount }) : null,
      item.libraryBytes > 0 ? formatBytes(item.libraryBytes) : null,
    ].filter(Boolean).join(" · ")
    : formatBytes(job?.size ?? 0);

  const head = (
    <>
      <span aria-hidden className="flex h-[54px] w-24 flex-none items-center justify-center overflow-hidden rounded-[12px] bg-surface-2 text-ink-2">
        {poster ? <img src={poster} alt="" className="h-full w-full object-cover" />
          : item?.kind === "audio" ? <MusicIcon className="h-6 w-6" /> : <ClapperboardIcon className="h-6 w-6" />}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-body font-semibold tracking-[-0.01em]">{title}</span>
        {ready && item ? (
          <span className="mt-1 flex min-w-0 flex-wrap items-center gap-1">
            <ToneBadge tone="green">{t("web.library.status.ready")}</ToneBadge>
            {item.subSource ? <ToneBadge tone="gray">{t(`web.library.sub.${item.subSource}`)}</ToneBadge> : null}
          </span>
        ) : null}
        {meta ? <span className="num mt-[3px] block truncate text-meta text-ink-2">{meta}</span> : null}
      </span>
    </>
  );

  let body: ReactNode = null;
  if (job?.state === "uploading") {
    const pct = job.size > 0 ? Math.round((job.sent / job.size) * 100) : 0;
    const label = t("web.library.card.uploading", { pct });
    body = (
      <>
        <ProgressBar pct={pct} label={label} />
        <div className="mt-1 flex items-center justify-between gap-2 text-meta text-ink-2">
          <span className="num">{label}</span>
          <button type="button" className={TEXT_BUTTON} onClick={() => h.onCancelUpload(job)}>
            <XIcon aria-hidden />{t("web.library.card.cancelUpload")}
          </button>
        </div>
      </>
    );
  } else if (job) {
    body = (
      <>
        <p role="alert" className="mt-2 text-meta text-ink-2">
          {t("web.library.card.uploadFailed", { reason: translateServerError(t, job.error, LIBRARY_SERVER_ERRORS) })}
        </p>
        <div className="mt-1 flex flex-wrap gap-1">
          <button type="button" className={TEXT_BUTTON} onClick={() => h.onRetryUpload(job)}>
            <RotateCcwIcon aria-hidden />{t("web.library.card.retry")}
          </button>
          <button type="button" className={TEXT_BUTTON} onClick={() => h.onDismissUpload(job)}>{t("web.library.card.dismiss")}</button>
        </div>
      </>
    );
  } else if (item?.status === "queued" || item?.status === "processing") {
    const stage = item.stage ? t(`web.library.stage.${item.stage}`) : t(`web.library.status.${item.status}`);
    const steps: StepperStep[] = stagesFor(item.source).map((key) => ({ key, label: t(`web.library.stage.${key}`) }));
    body = (
      <div role="progressbar" aria-label={stage} aria-valuemin={0} aria-valuemax={100} aria-valuenow={clampPct(item.progress)} className="mt-2.5">
        <p className="num text-meta"><ShinyText>{t("web.library.progress", { stage, pct: item.progress })}</ShinyText></p>
        <Stepper steps={steps} current={item.status === "processing" ? item.stage : null} />
      </div>
    );
  } else if (item?.status === "failed") {
    const actions = failedActions(item.errorKind);
    body = (
      <>
        <p data-testid="library-item-reason" className="mt-2 text-meta text-ink-2">{t(errorKindKey(item.errorKind))}</p>
        <div className="mt-1 flex flex-wrap gap-1">
          {actions.retry ? (
            <button type="button" className={TEXT_BUTTON} onClick={() => h.onRetry(item)}>
              <RotateCcwIcon aria-hidden />{t("web.library.card.retry")}
            </button>
          ) : null}
          {actions.subtitles ? (
            <button type="button" className={TEXT_BUTTON} onClick={() => h.onAddSubtitles(item)}>
              <FileTextIcon aria-hidden />{t("web.library.card.addSubtitles")}
            </button>
          ) : null}
        </div>
      </>
    );
  } else if (item?.status === "uploading") {
    body = (
      <div className="mt-1 flex items-center justify-between gap-2 text-meta text-ink-2">
        <span>{t("web.library.status.uploading")}</span>
        <button type="button" className={TEXT_BUTTON} onClick={() => h.onResumeUpload(item)}>
          <UploadIcon aria-hidden />{t("web.library.card.resumeUpload")}
        </button>
      </div>
    );
  } else if (item?.status === "canceled") {
    body = <p className="mt-2 text-meta text-ink-2">{t("web.library.status.canceled")}</p>;
  }

  return (
    <li ref={ref} data-testid={`library-item-${item?.id ?? job?.key ?? ""}`} data-state={state}>
      <SpotlightCard className={cn("lib-rise rounded-[18px] p-3")} style={{ "--lib-delay": `${(Math.min(index, 8) * 0.07).toFixed(2)}s` } as CSSProperties}>
        <div className="flex items-center gap-2">
          {ready && item ? (
            <Link to={`/library/${encodeURIComponent(item.id)}`}
              className="-m-1 flex min-w-0 flex-1 items-center gap-3 rounded-button p-1 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
              {head}
              <ChevronRightIcon aria-hidden className="h-[18px] w-[18px] flex-none text-ink-3" />
            </Link>
          ) : <div className="flex min-w-0 flex-1 items-center gap-3">{head}</div>}
          {item && job?.state !== "uploading" ? (
            <IconButton label={t("web.library.card.delete")} onClick={() => h.onDelete(item)} className="text-ink-2">
              <Trash2Icon aria-hidden />
            </IconButton>
          ) : null}
        </div>
        {body}
      </SpotlightCard>
    </li>
  );
}
