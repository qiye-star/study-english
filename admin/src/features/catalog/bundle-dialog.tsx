import { useEffect, useId, useState } from "react";
import { Dialog } from "../../components/dialog";
import { errorText as apiErrorText } from "../../hooks/use-async";
import { importBundle, listBundles, type BundleRow } from "./api";
import { S, errorText } from "./strings";

/** 从 bundle 导入(plan L1 Task 23):只列出本库还没有的条目;需要理由;导入不跑流水线、不花识别与译文费用。 */
export function BundleDialog({ open, onClose, onDone }: { open: boolean; onClose: () => void; onDone: () => void }) {
  const id = useId();
  const [rows, setRows] = useState<BundleRow[]>([]);
  const [chosen, setChosen] = useState("");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setChosen("");
    setReason("");
    setError(null);
    listBundles()
      .then((all) => setRows(all.filter((b) => b.importable)))
      .catch((e) => setError(errorText(apiErrorText(e))));
  }, [open]);

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      await importBundle(chosen, reason.trim());
      onDone();
      onClose();
    } catch (e) {
      setError(errorText(apiErrorText(e)));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onClose={onClose} title={S.bundle.title}
      footer={
        <>
          <button type="button" className="btn-ghost btn-sm" onClick={onClose}>{S.form.cancel}</button>
          <button type="button" className="btn-primary btn-sm" disabled={busy || !chosen || !reason.trim()} onClick={submit}>
            {S.bundle.import}
          </button>
        </>
      }>
      <div className="space-y-3">
        {rows.length === 0 && <p className="text-sm text-fg-2">{S.bundle.none}</p>}
        <label className="block text-sm" htmlFor={`${id}-pick`}>{S.bundle.pick}</label>
        <select id={`${id}-pick`} className="w-full" value={chosen} onChange={(e) => setChosen(e.target.value)}>
          <option value="">—</option>
          {rows.map((b) => <option key={b.catalogId} value={b.catalogId}>{`${b.catalogId.slice(0, 8)} · ${b.bytes} B`}</option>)}
        </select>
        <label className="block text-sm" htmlFor={`${id}-reason`}>{S.bundle.reason}</label>
        <input id={`${id}-reason`} className="w-full" value={reason} onChange={(e) => setReason(e.target.value)} maxLength={200} />
        {error && <p role="alert" className="text-sm text-bad">{error}</p>}
      </div>
    </Dialog>
  );
}
