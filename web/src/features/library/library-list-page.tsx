import { PlusIcon } from "lucide-react";
import { type ChangeEvent, type CSSProperties, useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Navigate, useSearchParams } from "react-router-dom";
import { toast } from "sonner";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter,
  AlertDialogHeader, AlertDialogTitle,
} from "@renderer/components/ui/alert-dialog";
import { translateServerError } from "~/api/error-messages";
import { useAuth } from "~/auth/auth-context";
import { SegmentedControl } from "~/components/segmented-control";
import { PageHeader } from "~/layout/page-header";
import { AddSheet } from "./add-sheet";
import { CatalogView } from "./catalog-view";
import { fetchLibraryConfig, type LibraryConfig } from "./config";
import { CountUp } from "./fx/count-up";
import { formatBytes } from "./format";
import { ItemCard } from "./item-card";
import {
  LIBRARY_FORMATS, LIBRARY_SERVER_ERRORS, MAX_SUBTITLE_BYTES, MIB, SUBTITLE_FORMATS, deleteItem, extOf, limitsOrDefault,
  putItemSubtitles, rebuildItem, reprocessItem, retryItem, type LibraryItem,
} from "./library-api";
import { LibraryRoot } from "./library-root";
import "./locales";
import { PageError, PageLoading, PageNote } from "./page-status";
import { GHOST, PRIMARY } from "./ui";
import { UploadMismatchError, type UploadInput } from "./upload-client";
import { type UploadJob, uploads, useUploads } from "./upload-store";
import { useLibraryItems } from "./use-library-items";

/** `/library`(spec §11.2):每次进入重新取 config(要最新的已用空间,R-L6)。 */
export function LibraryListPage() {
  const { t } = useTranslation();
  const { api } = useAuth();
  const [params, setParams] = useSearchParams();
  const [config, setConfig] = useState<LibraryConfig | null>(null);
  const [configError, setConfigError] = useState<unknown>(null);
  const loadConfig = useCallback(() => {
    fetchLibraryConfig(api).then((c) => {
      setConfig(c);
      setConfigError(null);
    }, setConfigError);
  }, [api]);
  useEffect(loadConfig, [loadConfig]);

  const enabled = config?.enabled === true;
  const list = useLibraryItems(enabled);
  const jobs = useUploads();
  const [sheetOpen, setSheetOpen] = useState(false);
  const [pendingDelete, setPendingDelete] = useState<LibraryItem | null>(null);
  const [pendingReprocess, setPendingReprocess] = useState<LibraryItem | null>(null);
  const [pendingRebuild, setPendingRebuild] = useState<LibraryItem | null>(null);
  const subsInput = useRef<HTMLInputElement>(null);
  const resumeInput = useRef<HTMLInputElement>(null);
  const target = useRef<LibraryItem | null>(null);
  const limits = limitsOrDefault(config?.limits ?? null);

  const fail = useCallback((err: unknown) => {
    toast.error(translateServerError(t, err, LIBRARY_SERVER_ERRORS));
  }, [t]);
  const { refresh } = list;
  const startOptions = useCallback(() => ({
    chunkBytes: limits.chunkBytes,
    onDone: () => {
      toast.success(t("web.library.toast.uploadDone"));
      void refresh().catch(() => {});
      loadConfig();
    },
  }), [limits.chunkBytes, t, refresh, loadConfig]);

  if (configError && !config) {
    return (
      <div className="flex flex-1 flex-col">
        <PageHeader title={t("web.library.title")} />
        <PageError message={translateServerError(t, configError, LIBRARY_SERVER_ERRORS)} onRetry={loadConfig} />
      </div>
    );
  }
  if (!config) return <PageLoading />;
  if (!enabled) return <Navigate to="/practice" replace />;
  // R-W1:`?tab=catalog` 只在服务端开着精选库时生效,否则被忽略(回到「我的」)
  const tab: "mine" | "catalog" = config.catalog && params.get("tab") === "catalog" ? "catalog" : "mine";
  const onTab = (next: "mine" | "catalog") => setParams(next === "catalog" ? { tab: "catalog" } : {}, { replace: true });

  const onUpload = (input: UploadInput) => {
    setSheetOpen(false);
    uploads.start(api, input, startOptions());
  };
  const onImported = (item: LibraryItem) => {
    setSheetOpen(false);
    list.replace(item);
    toast.success(t("web.library.toast.imported"));
  };
  const confirmDelete = async () => {
    const item = pendingDelete;
    setPendingDelete(null);
    if (!item) return;
    try {
      await deleteItem(api, item.id);
      list.remove(item.id);
      toast.success(t("web.library.toast.deleted"));
      loadConfig();
    } catch (err) {
      fail(err);
    }
  };
  const confirmReprocess = async () => {
    const item = pendingReprocess;
    setPendingReprocess(null);
    if (!item) return;
    try {
      list.replace(await reprocessItem(api, item.id));
      toast.success(t("web.library.toast.reprocessing"));
    } catch (err) {
      fail(err);
    }
  };

  const confirmRebuild = async () => {
    const item = pendingRebuild;
    setPendingRebuild(null);
    if (!item) return;
    try {
      const { segments: _segments, ...next } = await rebuildItem(api, item.id);
      list.replace(next);
      toast.success(t("web.library.toast.rebuilt"));
    } catch (err) {
      fail(err);
    }
  };

  const onRetry = (item: LibraryItem) => {
    retryItem(api, item.id).then((next) => {
      list.replace(next);
      toast(t("web.library.toast.retrying"));
    }, fail);
  };
  const onAddSubtitles = (item: LibraryItem) => {
    target.current = item;
    subsInput.current?.click();
  };
  const onSubtitlesChosen = (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    const item = target.current;
    if (!file || !item) return;
    if (!(SUBTITLE_FORMATS as readonly string[]).includes(extOf(file.name))) {
      toast.error(t("web.library.upload.subtitleBadType"));
      return;
    }
    if (file.size > MAX_SUBTITLE_BYTES) {
      toast.error(t("web.library.upload.subtitleTooLarge"));
      return;
    }
    putItemSubtitles(api, item.id, file, file.name).then((next) => {
      list.replace(next);
      toast.success(t("web.library.toast.subtitlesSaved"));
    }, fail);
  };
  const onResumeUpload = (item: LibraryItem) => {
    target.current = item;
    resumeInput.current?.click();
  };
  const onResumeChosen = (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    const item = target.current;
    if (!file || !item) return;
    const remembered = uploads.rememberedName(item.id);
    if (remembered && remembered !== file.name) {
      toast.error(t("web.library.resume.mismatch"));
      return;
    }
    let key = "";
    key = uploads.start(api, { file, filename: file.name, title: item.title }, {
      ...startOptions(),
      resumeItemId: item.id,
      onError: (err) => {
        if (err instanceof UploadMismatchError) {
          uploads.dismiss(key);
          toast.error(t("web.library.resume.mismatch"));
        }
      },
    });
  };
  const onCancelUpload = (job: UploadJob) => {
    void uploads.cancel(api, job.key).then(() => {
      if (job.itemId) list.remove(job.itemId);
      loadConfig();
    });
  };

  const handlers = {
    onDelete: setPendingDelete,
    onReprocess: config.asr ? setPendingReprocess : undefined,
    onRebuild: setPendingRebuild,
    onRetry,
    onAddSubtitles,
    onResumeUpload,
    onCancelUpload,
    onRetryUpload: (job: UploadJob) => { uploads.retry(api, job.key, startOptions()); },
    onDismissUpload: (job: UploadJob) => uploads.dismiss(job.key),
  };
  const shownIds = new Set(list.items.map((i) => i.id));
  const jobByItem = new Map(jobs.filter((j) => j.itemId).map((j) => [j.itemId as string, j]));
  const looseJobs = jobs.filter((j) => !j.itemId || !shownIds.has(j.itemId));
  const formats = limits.formats.length ? limits.formats : [...LIBRARY_FORMATS];
  const usedBytes = limits.usedBytes;
  const quotaBytes = limits.quotaMb * MIB;
  const usedShare = quotaBytes > 0 ? Math.min(1, usedBytes / quotaBytes) : 0;
  const empty = list.items.length === 0 && jobs.length === 0;

  return (
    <LibraryRoot>
      {/* 标签根页:没有返回键(R-L34);顶栏沿用全站 PageHeader(滚动后才变玻璃) */}
      <PageHeader title={t("web.library.title")} />
      {config.catalog ? (
        <div className="lib-cat-tabs">
          <SegmentedControl<"mine" | "catalog"> label={t("web.library.catalog.tabs")} value={tab} onChange={onTab} className="lib-seg flex w-full" optionClassName="flex-1"
            options={[
              { value: "mine", label: t("web.library.catalog.tabMine"), testId: "library-tab-mine" },
              { value: "catalog", label: t("web.library.catalog.tabCatalog"), testId: "library-tab-catalog" },
            ]} />
        </div>
      ) : null}
      {tab === "catalog" ? <div className="pb-24"><CatalogView /></div> : <>
      <div data-testid="library-usage" className="lib-quota">
        <span className="num">
          {t("web.library.usedLabel")} <CountUp to={usedBytes} format={formatBytes} /> / {formatBytes(quotaBytes)}
        </span>
        <div aria-hidden className="lib-quota-bar"><div className="lib-quota-fill" style={{ "--p": usedShare } as CSSProperties} /></div>
      </div>
      <div className="px-gutter pb-24">
        {list.error && empty ? (
          <PageError message={translateServerError(t, list.error, LIBRARY_SERVER_ERRORS)} onRetry={() => void list.reload()} />
        ) : list.loading && empty ? (
          <PageLoading />
        ) : empty ? (
          <PageNote>{t("web.library.empty")}</PageNote>
        ) : (
          <ul className="mt-2 flex flex-col gap-2" data-testid="library-list">
            {looseJobs.map((job, i) => <ItemCard key={job.key} item={null} job={job} index={i} {...handlers} />)}
            {list.items.map((item, i) => <ItemCard key={item.id} item={item} job={jobByItem.get(item.id)} index={looseJobs.length + i} {...handlers} />)}
          </ul>
        )}
        {list.nextCursor ? (
          <button type="button" disabled={list.loadingMore} onClick={() => void list.loadMore()} className={`${GHOST} mt-3 h-11 w-full`}>
            {t("web.common.loadMore")}
          </button>
        ) : null}
      </div>
      <div className="lib-fab">
        <button type="button" data-testid="library-add" aria-label={t("web.library.add")} className={`${PRIMARY} h-12 px-5`} onClick={() => setSheetOpen(true)}>
          <PlusIcon aria-hidden />{t("web.library.addShort")}
        </button>
      </div>
      </>}
      <input ref={subsInput} type="file" accept=".srt,.vtt" hidden data-testid="library-subtitles-input" onChange={onSubtitlesChosen} />
      <input ref={resumeInput} type="file" accept={["audio/*", "video/*", ...formats.map((f) => `.${f}`)].join(",")} hidden
        data-testid="library-resume-input" onChange={onResumeChosen} />
      <AddSheet open={sheetOpen} onOpenChange={setSheetOpen} config={config} onUpload={onUpload} onImported={onImported} />
      <AlertDialog open={!!pendingDelete} onOpenChange={(open) => { if (!open) setPendingDelete(null); }}>
        <AlertDialogContent className="rounded-sheet border-[0.5px] border-hair bg-surface">
          <AlertDialogHeader>
            <AlertDialogTitle className="text-title font-semibold text-ink">{t("web.library.confirmDelete.title")}</AlertDialogTitle>
            <AlertDialogDescription className="text-sub text-ink-2">
              {t(pendingDelete?.source === "catalog" ? "web.library.catalog.deleteCopyBody" : "web.library.confirmDelete.body")}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="h-11 rounded-button">{t("web.common.cancel")}</AlertDialogCancel>
            <AlertDialogAction className="h-11 rounded-button" onClick={() => void confirmDelete()}>
              {t("web.library.confirmDelete.confirm")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      <AlertDialog open={!!pendingReprocess} onOpenChange={(open) => { if (!open) setPendingReprocess(null); }}>
        <AlertDialogContent className="rounded-sheet border-[0.5px] border-hair bg-surface">
          <AlertDialogHeader>
            <AlertDialogTitle className="text-title font-semibold text-ink">{t("web.library.confirmReprocess.title")}</AlertDialogTitle>
            <AlertDialogDescription className="text-sub text-ink-2">{t("web.library.confirmReprocess.body")}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="h-11 rounded-button">{t("web.common.cancel")}</AlertDialogCancel>
            <AlertDialogAction className="h-11 rounded-button" onClick={() => void confirmReprocess()}>
              {t("web.library.confirmReprocess.confirm")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      <AlertDialog open={!!pendingRebuild} onOpenChange={(open) => { if (!open) setPendingRebuild(null); }}>
        <AlertDialogContent className="rounded-sheet border-[0.5px] border-hair bg-surface">
          <AlertDialogHeader>
            <AlertDialogTitle className="text-title font-semibold text-ink">{t("web.library.confirmRebuild.title")}</AlertDialogTitle>
            <AlertDialogDescription className="text-sub text-ink-2">{t("web.library.confirmRebuild.body")}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="h-11 rounded-button">{t("web.common.cancel")}</AlertDialogCancel>
            <AlertDialogAction className="h-11 rounded-button" onClick={() => void confirmRebuild()}>
              {t("web.library.confirmRebuild.confirm")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </LibraryRoot>
  );
}
