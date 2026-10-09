import { useEffect, useState } from "react";
import { Dialog } from "../../components/dialog";
import { MIN_REASON } from "../../components/confirm-dialog";
import { SpinnerIcon } from "../../components/icons";
import { errorText } from "../../hooks/use-async";
import { S as Shell } from "../../strings";
import { S } from "./strings";

/** 加减点:非零整数 + 理由(写审计);减点不降级(服务端保证)。 */
export function AdjustDialog({ open, onSubmit, onClose }: { open: boolean; onSubmit: (delta: number, reason: string) => Promise<void>; onClose: () => void }) {
  const [delta, setDelta] = useState("");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setDelta("");
      setReason("");
      setError(null);
      setBusy(false);
    }
  }, [open]);

  const n = Number(delta);
  const deltaOk = delta.trim() !== "" && Number.isInteger(n) && n !== 0 && Math.abs(n) <= 1000;
  const ok = deltaOk && reason.trim().length >= MIN_REASON && !busy;

  const submit = async () => {
    if (!ok) return;
    setBusy(true);
    setError(null);
    try {
      await onSubmit(n, reason.trim());
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog
      open={open}
      title={S.adjust.title}
      onClose={onClose}
      footer={
        <>
          <button type="button" className="btn-ghost btn-sm" onClick={onClose} disabled={busy}>
            {Shell.dialogs.cancel}
          </button>
          <button type="button" className="btn-primary btn-sm" disabled={!ok} onClick={submit}>
            {busy && <SpinnerIcon width={14} height={14} />}
            {Shell.dialogs.confirm}
          </button>
        </>
      }
    >
      <label className="block space-y-1">
        <span className="text-xs font-medium text-fg-2">{S.adjust.delta}</span>
        <input type="number" className="field-sm num" value={delta} min={-1000} max={1000} step={1} onChange={(e) => setDelta(e.target.value)} />
      </label>
      {delta.trim() !== "" && !deltaOk && <p className="text-xs text-bad">{S.adjust.invalid}</p>}
      <p className="text-xs text-fg-2">{S.adjust.note}</p>
      <label className="block space-y-1">
        <span className="text-xs font-medium text-fg-2">{Shell.dialogs.reason}</span>
        <textarea
          className="field-sm h-auto min-h-[64px] py-2"
          value={reason}
          maxLength={200}
          placeholder={Shell.dialogs.reasonHint}
          onChange={(e) => setReason(e.target.value)}
        />
      </label>
      {error && (
        <p role="alert" className="rounded-lg border border-bad/30 bg-bad-soft px-3 py-2 text-bad">
          {error}
        </p>
      )}
    </Dialog>
  );
}
