import { useEffect, useId, useState } from "react";
import { Dialog } from "../../components/dialog";
import { errorText as apiErrorText } from "../../hooks/use-async";
import { importLink, type CatalogState } from "./api";
import { MetaFields, emptyDraft, metaOf, type MetaDraft } from "./meta-fields";
import { S, errorText } from "./strings";

/** 按链接导入:链接 + 元数据;错误显示在框内(映射到中文),成功后关闭并刷新。 */
export function ImportDialog({ open, state, onClose, onDone }: { open: boolean; state: CatalogState; onClose: () => void; onDone: () => void }) {
  const id = useId();
  const [url, setUrl] = useState("");
  const [draft, setDraft] = useState<MetaDraft>(() => emptyDraft(state));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setUrl("");
      setDraft(emptyDraft(state));
      setBusy(false);
      setError(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      await importLink(url.trim(), metaOf(draft));
      onDone();
      onClose();
    } catch (e) {
      setError(errorText(apiErrorText(e)));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog
      open={open}
      title={S.actions.importLink}
      onClose={busy ? () => undefined : onClose}
      footer={
        <>
          <button type="button" className="btn-ghost btn-sm" onClick={onClose} disabled={busy}>{S.form.cancel}</button>
          <button type="button" className="btn-primary btn-sm" disabled={busy || !state.link || !url.trim()} onClick={submit}>{S.form.submit}</button>
        </>
      }
    >
      {!state.link && <p className="text-warn">{S.state.link(false, state.proxyConfigured)}</p>}
      <div className="space-y-1">
        <label htmlFor={`${id}-url`} className="block text-xs font-medium text-fg-2">{S.form.url}</label>
        <input id={`${id}-url`} className="field-sm" value={url} maxLength={4000} autoComplete="off" onChange={(e) => setUrl(e.target.value)} />
        <p className="text-2xs text-muted">{S.form.urlHint}</p>
      </div>
      <MetaFields draft={draft} state={state} onChange={setDraft} />
      {error && <p role="alert" className="rounded-lg border border-bad/30 bg-bad-soft px-3 py-2 text-bad">{error}</p>}
    </Dialog>
  );
}
