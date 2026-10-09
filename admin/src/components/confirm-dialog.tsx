import { useEffect, useState, type ReactNode } from "react";
import { errorText } from "../hooks/use-async";
import { S } from "../strings";
import { Dialog } from "./dialog";
import { SpinnerIcon } from "./icons";

export const MIN_REASON = 4;

/**
 * 危险操作确认(spec §3.8):可选"输入短语确认"与"理由"(≥ 4 字,写入审计)。
 * onConfirm 抛错时错误显示在框内,框不关闭。
 */
export function ConfirmDialog({
  open,
  title,
  body,
  items,
  confirmText = S.dialogs.confirm,
  requireTyping,
  reasonRequired = false,
  danger = false,
  onConfirm,
  onClose,
}: {
  open: boolean;
  title: string;
  body?: ReactNode;
  /** 额外内容(例如 DiffTable) */
  items?: ReactNode;
  confirmText?: string;
  /** 必须原样输入的短语(env 名、`CONFIRM`、`RESET 12 USERS` 等) */
  requireTyping?: string;
  reasonRequired?: boolean;
  danger?: boolean;
  onConfirm: (reason: string) => Promise<void> | void;
  onClose: () => void;
}) {
  const [typed, setTyped] = useState("");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setTyped("");
      setReason("");
      setError(null);
      setBusy(false);
    }
  }, [open]);

  const typedOk = !requireTyping || typed === requireTyping;
  const reasonOk = !reasonRequired || reason.trim().length >= MIN_REASON;
  const canConfirm = typedOk && reasonOk && !busy;

  const confirm = async () => {
    if (!canConfirm) return;
    setBusy(true);
    setError(null);
    try {
      await onConfirm(reason.trim());
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog
      open={open}
      title={title}
      onClose={busy ? () => undefined : onClose}
      footer={
        <>
          <button type="button" className="btn-ghost btn-sm" onClick={onClose} disabled={busy}>
            {S.dialogs.cancel}
          </button>
          <button type="button" className={`${danger ? "btn-danger" : "btn-primary"} btn-sm`} disabled={!canConfirm} onClick={confirm}>
            {busy && <SpinnerIcon width={14} height={14} />}
            {confirmText}
          </button>
        </>
      }
    >
      {body && <div className="leading-relaxed text-fg-2">{body}</div>}
      {items}
      {requireTyping && (
        <label className="block space-y-1">
          <span className="text-xs font-medium text-fg-2">{S.dialogs.typeToConfirm(requireTyping)}</span>
          <input
            className="field-sm font-mono"
            value={typed}
            onChange={(e) => setTyped(e.target.value)}
            autoComplete="off"
            spellCheck={false}
          />
        </label>
      )}
      {reasonRequired && (
        <label className="block space-y-1">
          <span className="text-xs font-medium text-fg-2">{S.dialogs.reason}</span>
          <textarea
            className="field-sm h-auto min-h-[64px] py-2"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            maxLength={200}
            placeholder={S.dialogs.reasonHint}
          />
        </label>
      )}
      {error && (
        <p role="alert" className="rounded-lg border border-bad/30 bg-bad-soft px-3 py-2 text-bad">
          {error}
        </p>
      )}
    </Dialog>
  );
}
