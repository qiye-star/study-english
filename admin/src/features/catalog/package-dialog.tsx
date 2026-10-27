import { useEffect, useId, useMemo, useState, useSyncExternalStore } from "react";
import { Dialog } from "../../components/dialog";
import { errorText as apiErrorText } from "../../hooks/use-async";
import { md5Blob } from "../../lib/md5";
import { entryBlob, ZipError } from "../../lib/zip-reader";
import { checkPackage, completeUpload, fetchCatalog, putSubtitles, startReplace, startUpload, cancel, type CatalogState, type PackageMatch } from "./api";
import { MetaFields, emptyDraft, metaOf, type MetaDraft } from "./meta-fields";
import { PackagePreview } from "./package-preview";
import { categorize, defaultSelected, parsePackage, PackageError, type Mode, type PackageModel, type PlanRow } from "./package-model";
import { PackageRunner, summarize, type RunItem, type RunnerDeps, type RunnerState } from "./package-runner";
import { S, errorText } from "./strings";
import { uploadChunks } from "./upload";

const realDeps: RunnerDeps = {
  startUpload: (filename, size, meta, md5) => startUpload(filename, size, meta, md5),
  startReplace: (id, filename, size) => startReplace(id, filename, size),
  uploadChunks: (id, file, chunk, onProgress, signal, send, startChunk) => uploadChunks(id, file, chunk, onProgress, signal, send, startChunk),
  putSubtitles: (id, file, name) => putSubtitles(id, file, name),
  completeUpload: (id) => completeUpload(id),
  cancel: (id) => cancel(id),
  fetchCatalog: () => fetchCatalog(),
  md5Blob: (blob, opts) => md5Blob(blob, opts),
};

const EMPTY_STATE: RunnerState = { status: "idle", paused: null, waiting: false, index: 0, total: 0, percent: 0, results: [] };
const noSubscribe = () => () => {};
const noSnapshot = () => EMPTY_STATE;

/** 按当前模式为每条算一行预览(纯函数)。 */
function planRows(model: PackageModel, matches: Record<string, PackageMatch[]>, mode: Mode): PlanRow[] {
  return model.items.map((item) => categorize(item, matches[item.sourceMd5] ?? [], mode));
}

/**
 * 导入包对话框(plan 2026-10-27 R-A1、R-A4–R-A7):选 zip → 本地校验 → 服务端包检查 → 预览 → 批次导入(对话框内运行)。
 * 运行中不能用遮罩 / Esc 关闭,只能「停止」;关闭时若有已上传的条目,表格会照常轮询。
 */
export function PackageDialog({ open, state, onClose, onDone }: { open: boolean; state: CatalogState; onClose: () => void; onDone: () => void }) {
  const id = useId();
  const [phase, setPhase] = useState<"pick" | "reading" | "checking" | "ready" | "running">("pick");
  const [file, setFile] = useState<File | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [model, setModel] = useState<PackageModel | null>(null);
  const [matches, setMatches] = useState<Record<string, PackageMatch[]>>({});
  const [mode, setMode] = useState<Mode>("skip");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [draft, setDraft] = useState<MetaDraft>(() => emptyDraft(state));
  const [runner, setRunner] = useState<PackageRunner | null>(null);

  const rows = useMemo(() => (model ? planRows(model, matches, mode) : []), [model, matches, mode]);
  const snap = useSyncExternalStore(runner ? runner.subscribe : noSubscribe, runner ? runner.getState : noSnapshot);
  const live = runner !== null && (snap.status === "running" || snap.status === "paused");
  const finished = runner !== null && (snap.status === "done" || snap.status === "stopped");

  useEffect(() => {
    if (open) {
      setPhase("pick");
      setFile(null);
      setError(null);
      setModel(null);
      setMatches({});
      setMode("skip");
      setSelected(new Set());
      setDraft(emptyDraft(state));
      setRunner(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  // 运行中离开页面会中断上传:提示
  useEffect(() => {
    if (!live) return;
    const warn = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = S.package.leaveWarn;
      return S.package.leaveWarn;
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [live]);

  // 结束后让表格刷新一次(新建 / 覆盖的条目进入服务器处理)
  useEffect(() => {
    if (finished) onDone();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [finished]);

  const requestClose = () => {
    if (live) return;
    onClose();
  };

  const pick = async (f: File | null) => {
    setError(null);
    setFile(f);
    setModel(null);
    setMatches({});
    setRunner(null);
    if (!f) {
      setPhase("pick");
      return;
    }
    setPhase("reading");
    let m: PackageModel;
    try {
      m = await parsePackage(f, { maxUploadMb: state.maxUploadMb });
    } catch (e) {
      const reason = e instanceof PackageError || e instanceof ZipError ? e.reason : null;
      setError((reason && S.package.reasons[reason]) || S.package.readFailed);
      setPhase("pick");
      return;
    }
    setPhase("checking");
    const md5s = m.items.filter((i) => !i.skip).map((i) => i.sourceMd5);
    let found: PackageMatch[] = [];
    try {
      found = md5s.length ? await checkPackage(md5s) : [];
    } catch (e) {
      setError(errorText(apiErrorText(e)));
      setPhase("pick");
      return;
    }
    const grouped: Record<string, PackageMatch[]> = {};
    for (const m2 of found) (grouped[m2.sourceMd5] ??= []).push(m2);
    setModel(m);
    setMatches(grouped);
    setMode("skip");
    setSelected(new Set(planRows(m, grouped, "skip").filter(defaultSelected).map((r) => r.item.sourceMd5)));
    setPhase("ready");
  };

  const changeMode = (next: Mode) => {
    if (!model) return;
    setMode(next);
    setSelected(new Set(planRows(model, matches, next).filter(defaultSelected).map((r) => r.item.sourceMd5)));
  };

  const toggle = (md5: string, on: boolean) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (on) next.add(md5);
      else next.delete(md5);
      return next;
    });
  };

  const chosen = rows.filter((r) => selected.has(r.item.sourceMd5) && r.action !== null);

  const start = () => {
    if (!file || chosen.length === 0) return;
    const items: RunItem[] = chosen.map((r) => {
      const it = r.item;
      return {
        sourceMd5: it.sourceMd5,
        title: it.title,
        action: r.action as RunItem["action"],
        catalogId: r.match?.catalogId ?? null,
        uploadReceived: r.match?.uploadReceived ?? 0,
        mediaName: `media.${it.mediaExt}`,
        media: entryBlob(file, it.media as NonNullable<typeof it.media>),
        mediaBytes: it.mediaBytes,
        mediaMd5: it.mediaMd5,
        subtitle: entryBlob(file, it.subtitle as NonNullable<typeof it.subtitle>),
        subtitleMd5: it.subtitleMd5,
      };
    });
    const r = new PackageRunner(items, realDeps, { chunkBytes: state.chunkBytes, meta: metaOf({ ...draft, title: "" }) });
    setPhase("running");
    setRunner(r);
    r.start();
  };

  const summary = finished ? summarize(snap.results, snap.total) : null;
  const unavailable = !state.available;

  return (
    <Dialog
      open={open}
      title={S.package.title}
      onClose={requestClose}
      width={760}
      footer={
        <>
          {live ? (
            <>
              {snap.paused && <button type="button" className="btn-primary btn-sm" onClick={() => runner?.resume()}>{S.package.resume}</button>}
              <button type="button" className="btn-ghost btn-sm" onClick={() => runner?.stop()}>{S.package.stop}</button>
            </>
          ) : (
            <>
              <button type="button" className="btn-ghost btn-sm" onClick={requestClose}>{finished ? S.package.close : S.form.cancel}</button>
              {phase === "ready" && (
                <button type="button" className="btn-primary btn-sm" disabled={unavailable || chosen.length === 0} onClick={start}>
                  {S.package.start(chosen.length)}
                </button>
              )}
            </>
          )}
        </>
      }
    >
      <p className="text-xs text-fg-2">{S.package.intro}</p>
      {unavailable && <p className="text-warn">{S.package.unavailable}</p>}
      {!runner && (
        <div className="space-y-1">
          <label htmlFor={`${id}-file`} className="block text-xs font-medium text-fg-2">{S.package.pick}</label>
          <input
            id={`${id}-file`}
            type="file"
            className="block w-full text-sm"
            accept=".zip,application/zip"
            disabled={phase === "reading" || phase === "checking"}
            onChange={(e) => void pick(e.target.files?.[0] ?? null)}
          />
        </div>
      )}
      {phase === "reading" && <p className="text-sm text-fg-2">{S.package.reading}</p>}
      {phase === "checking" && <p className="text-sm text-fg-2">{S.package.checking}</p>}
      {error && <p role="alert" className="rounded-lg border border-bad/30 bg-bad-soft px-3 py-2 text-bad">{error}</p>}

      {model && phase === "ready" && (
        <>
          <PackagePreview rows={rows} mode={mode} onMode={changeMode} selected={selected} onToggle={toggle} disabled={false} />
          <p className="text-2xs text-muted">{S.package.metaHint}</p>
          <MetaFields draft={draft} state={state} onChange={setDraft} withTitle={false} />
        </>
      )}

      {runner && (
        <div className="space-y-3" aria-live="polite">
          {live && <p className="text-sm text-fg">{S.package.running}</p>}
          <p className="num text-sm text-fg">{S.package.progress(snap.results.length, snap.total)}</p>
          {live && snap.index < snap.total && !snap.waiting && (
            <p className="num text-xs text-fg-2">{S.package.current(chosen[snap.index]?.item.title ?? "", snap.percent)}</p>
          )}
          {snap.waiting && <p className="text-xs text-fg-2">{S.package.waitingQueue}</p>}
          {snap.paused && <p role="alert" className="rounded-lg border border-warn/30 bg-warn-soft px-3 py-2 text-warn">{S.package.pauses[snap.paused]}</p>}
          {summary && (
            <div className="space-y-2 rounded-lg border border-line p-3">
              <p className="text-sm font-medium">{S.package.summaryTitle}</p>
              <p className="num text-xs text-fg-2">{S.package.summaryLine({ ...summary, failed: summary.failed.length })}</p>
              {summary.failed.length > 0 && (
                <div>
                  <p className="text-xs font-medium text-bad">{S.package.failedHeading}</p>
                  <ul className="mt-1 space-y-0.5 text-xs">
                    {summary.failed.map((f) => (
                      <li key={f.sourceMd5} className="text-bad">
                        {f.title}:{f.outcome.kind === "failed" ? S.package.failReasons[f.outcome.reason] ?? errorText(f.outcome.reason) : ""}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              <ul className="space-y-0.5 text-xs text-fg-2">
                {snap.results.filter((r) => r.outcome.kind !== "failed").map((r) => (
                  <li key={r.sourceMd5}>
                    {r.title}:{outcomeText(r.outcome)}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </Dialog>
  );
}

function outcomeText(o: RunnerState["results"][number]["outcome"]): string {
  switch (o.kind) {
    case "busy":
      return o.reason ? `进行中,跳过(${errorText(o.reason)})` : S.package.outcomes.busy;
    case "failed":
      return S.package.failed(S.package.failReasons[o.reason] ?? errorText(o.reason));
    default:
      return S.package.outcomes[o.kind];
  }
}
