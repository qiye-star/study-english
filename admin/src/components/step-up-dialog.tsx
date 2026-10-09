import { useEffect, useState, type FormEvent } from "react";
import { stepUp } from "../api/endpoints";
import { errorText } from "../hooks/use-async";
import { S } from "../strings";
import { Dialog } from "./dialog";
import { SpinnerIcon } from "./icons";

/** 二次验证(spec §4.6):重新输入密码(+ 已绑定时的 TOTP)。成功调用 onDone,原请求由客户端重放。 */
export function StepUpDialog({ open, totp, onDone, onClose }: { open: boolean; totp: boolean; onDone: () => void; onClose: () => void }) {
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setPassword("");
      setCode("");
      setError(null);
      setBusy(false);
    }
  }, [open]);

  const submit = async (e?: FormEvent) => {
    e?.preventDefault();
    if (busy || !password || (totp && !code.trim())) return;
    setBusy(true);
    setError(null);
    try {
      await stepUp(password, totp ? code.trim() : undefined);
      setPassword("");
      onDone();
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog
      open={open}
      title={S.dialogs.stepUpTitle}
      onClose={onClose}
      width={420}
      footer={
        <>
          <button type="button" className="btn-ghost btn-sm" onClick={onClose} disabled={busy}>
            {S.dialogs.cancel}
          </button>
          <button type="button" className="btn-primary btn-sm" onClick={() => submit()} disabled={busy || !password || (totp && !code.trim())}>
            {busy && <SpinnerIcon width={14} height={14} />}
            {S.dialogs.stepUpSubmit}
          </button>
        </>
      }
    >
      <form onSubmit={submit} className="space-y-3">
        <p className="leading-relaxed text-fg-2">{S.dialogs.stepUpBody}</p>
        <label className="block space-y-1">
          <span className="text-xs font-medium text-fg-2">{S.dialogs.password}</span>
          <input className="field-sm" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} />
        </label>
        {totp && (
          <label className="block space-y-1">
            <span className="text-xs font-medium text-fg-2">{S.dialogs.totpCode}</span>
            <input className="field-sm num" inputMode="numeric" autoComplete="one-time-code" value={code} onChange={(e) => setCode(e.target.value)} />
          </label>
        )}
        {error && (
          <p role="alert" className="rounded-lg border border-bad/30 bg-bad-soft px-3 py-2 text-bad">
            {error}
          </p>
        )}
        <button type="submit" className="hidden" aria-hidden="true" tabIndex={-1} />
      </form>
    </Dialog>
  );
}
