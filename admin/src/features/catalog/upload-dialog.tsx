import { useEffect, useId, useRef, useState } from "react";
import { Dialog } from "../../components/dialog";
import { errorText as apiErrorText } from "../../hooks/use-async";
import { completeUpload, putSubtitles, startUpload, type CatalogState } from "./api";
import { MetaFields, emptyDraft, metaOf, type MetaDraft } from "./meta-fields";
import { S, errorText } from "./strings";
import { uploadChunks } from "./upload";

/**
 * 上传文件(R-AU2):对话框内完成「建条目 → 分片 → 字幕 → complete」;关闭 = 中止上传,
 * 已建的条目留在 uploading,表格里可「取消」。
 */
export function UploadDialog({ open, state, onClose, onDone }: { open: boolean; state: CatalogState; onClose: () => void; onDone: () => void }) {
  const id = useId();
  const [file, setFile] = useState<File | null>(null);
  const [subs, setSubs] = useState<File | null>(null);
  const [draft, setDraft] = useState<MetaDraft>(() => emptyDraft(state));
  const [pct, setPct] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const ctrl = useRef<AbortController | null>(null);
  const busy = pct !== null;

  useEffect(() => {
    if (open) {
      setFile(null);
      setSubs(null);
      setDraft(emptyDraft(state));
      setPct(null);
      setError(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const close = () => {
    ctrl.current?.abort();
    onClose();
  };

  const submit = async () => {
    if (!file) return;
    if (file.size > state.maxUploadMb * 1024 * 1024) {
      setError(S.form.tooLarge(state.maxUploadMb));
      return;
    }
    const controller = new AbortController();
    ctrl.current = controller;
    setError(null);
    setPct(0);
    try {
      const started = await startUpload(file.name, file.size, metaOf(draft));
      await uploadChunks(started.catalogId, file, started.chunkBytes, (p) => setPct(Math.floor((p.sent * 100) / Math.max(1, p.total))), controller.signal);
      if (subs) await putSubtitles(started.catalogId, subs, subs.name);
      await completeUpload(started.catalogId);
      onDone();
      onClose();
    } catch (e) {
      if (!(e instanceof DOMException && e.name === "AbortError")) setError(errorText(apiErrorText(e)));
      setPct(null);
      onDone();
    } finally {
      ctrl.current = null;
    }
  };

  return (
    <Dialog
      open={open}
      title={S.actions.upload}
      onClose={close}
      footer={
        <>
          <button type="button" className="btn-ghost btn-sm" onClick={close}>{S.form.cancel}</button>
          <button type="button" className="btn-primary btn-sm" disabled={busy || !file || !state.available} onClick={submit}>{S.form.submit}</button>
        </>
      }
    >
      {!state.available && <p className="text-warn">{S.state.unavailable}</p>}
      <div className="space-y-1">
        <label htmlFor={`${id}-file`} className="block text-xs font-medium text-fg-2">{S.form.file}</label>
        <input id={`${id}-file`} type="file" className="block w-full text-sm" disabled={busy}
          accept={state.formats.map((f) => "." + f).join(",")} onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
      </div>
      <div className="space-y-1">
        <label htmlFor={`${id}-subs`} className="block text-xs font-medium text-fg-2">{S.form.subs}</label>
        <input id={`${id}-subs`} type="file" className="block w-full text-sm" disabled={busy} accept=".srt,.vtt"
          onChange={(e) => setSubs(e.target.files?.[0] ?? null)} />
      </div>
      <MetaFields draft={draft} state={state} onChange={setDraft} />
      {pct !== null && (
        <div className="space-y-1">
          <p className="num text-xs text-fg-2">{S.form.uploading(`${pct}%`)}</p>
          <div role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct} className="h-1.5 overflow-hidden rounded-full bg-sunken">
            <div className="h-full rounded-full bg-accent transition-[width]" style={{ width: `${pct}%` }} />
          </div>
        </div>
      )}
      {error && <p role="alert" className="rounded-lg border border-bad/30 bg-bad-soft px-3 py-2 text-bad">{error}</p>}
    </Dialog>
  );
}
