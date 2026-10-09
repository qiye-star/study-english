import { useState } from "react";
import { Dialog } from "../../components/dialog";
import { MIN_REASON } from "../../components/confirm-dialog";
import { SpinnerIcon } from "../../components/icons";
import { errorText } from "../../hooks/use-async";
import { S as Shell } from "../../strings";
import { importApply, importPreview, type ImportPreview, type SaveResult } from "./api";
import { formatValue } from "./model";
import { S } from "./strings";

const TONE: Record<string, string> = {
  changed: "bg-accent-soft text-accent-strong",
  unchanged: "bg-sunken text-fg-2",
  invalid: "bg-bad-soft text-bad",
  unknown: "bg-warn-soft text-warn",
  read_only: "bg-warn-soft text-warn",
  secret: "bg-sunken text-fg-2",
};

/** 导入设置(spec §3.7):选文件 → 逐项预览(修改/不变/拒绝及原因)→ 理由(+ 危险确认)→ 作为一个修订应用。 */
export function ImportDialog({ onClose, onApplied }: { onClose: () => void; onApplied: (r: SaveResult) => void }) {
  const [payload, setPayload] = useState<unknown>(null);
  const [preview, setPreview] = useState<ImportPreview | null>(null);
  const [reason, setReason] = useState("");
  const [typed, setTyped] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const pick = async (file: File | undefined) => {
    if (!file) return;
    setError(null);
    setPreview(null);
    setBusy(true);
    try {
      let parsed: unknown;
      try {
        parsed = JSON.parse(await file.text());
      } catch {
        throw new Error(S.importBadFile);
      }
      setPayload(parsed);
      setPreview(await importPreview(parsed));
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  };

  const changed = preview?.items.filter((i) => i.status === "changed").length ?? 0;
  const phrase = preview?.confirm ?? null;
  const canApply = !busy && changed > 0 && reason.trim().length >= MIN_REASON && (!phrase || typed.trim() === phrase);

  const apply = async () => {
    if (!canApply) return;
    setBusy(true);
    setError(null);
    try {
      onApplied(await importApply(payload, reason.trim(), phrase ? typed.trim() : null));
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog
      open
      title={S.importTitle}
      width={760}
      onClose={busy ? () => undefined : onClose}
      footer={
        <>
          <button type="button" className="btn-ghost btn-sm" onClick={onClose} disabled={busy}>
            {Shell.dialogs.cancel}
          </button>
          <button type="button" className="btn-primary btn-sm" onClick={apply} disabled={!canApply}>
            {busy && <SpinnerIcon width={14} height={14} />}
            {S.importApply}
          </button>
        </>
      }
    >
      <label className="block space-y-1">
        <span className="text-xs font-medium text-fg-2">{S.importPick}</span>
        <input type="file" accept="application/json,.json" onChange={(e) => pick(e.target.files?.[0])} />
      </label>
      {preview && (
        <table className="w-full border-collapse text-xs">
          <tbody>
            {preview.items.map((i) => (
              <tr key={i.env} className="align-top">
                <td className="border-b border-line py-1.5 pr-3 font-mono">{i.env}</td>
                <td className="border-b border-line py-1.5 pr-3">
                  <span className={`badge ${TONE[i.status] ?? ""}`}>{S.importStatus[i.status] ?? i.status}</span>
                </td>
                <td className="border-b border-line py-1.5">
                  {i.status === "changed" && (
                    <span className="num">
                      {formatValue(i.old ?? null)} → <b className="font-medium">{formatValue(i.new ?? null)}</b>
                    </span>
                  )}
                  {i.status === "invalid" && <span className="text-bad">{i.message}</span>}
                  {i.danger && i.danger.length > 0 && <p className="text-bad">{i.danger.join(";")}</p>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {preview && changed === 0 && <p className="text-xs text-fg-2">{S.importNothing}</p>}
      {preview && changed > 0 && (
        <>
          <label className="block space-y-1">
            <span className="text-xs font-medium text-fg-2">{Shell.dialogs.reason}</span>
            <textarea className="field-sm h-auto min-h-[56px] py-2" value={reason} maxLength={200} onChange={(e) => setReason(e.target.value)} placeholder={Shell.dialogs.reasonHint} />
          </label>
          {phrase && (
            <label className="block space-y-1">
              <span className="text-xs font-medium text-fg-2">{Shell.dialogs.typeToConfirm(phrase)}</span>
              <input className="field-sm font-mono" value={typed} onChange={(e) => setTyped(e.target.value)} autoComplete="off" spellCheck={false} />
            </label>
          )}
        </>
      )}
      {error && (
        <p role="alert" className="rounded-lg border border-bad/30 bg-bad-soft px-3 py-2 text-bad">
          {error}
        </p>
      )}
    </Dialog>
  );
}
