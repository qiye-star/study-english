import { useEffect, useState } from "react";
import { Dialog } from "../../components/dialog";
import { SpinnerIcon } from "../../components/icons";
import { errorText } from "../../hooks/use-async";
import { S as Shell } from "../../strings";
import { createInvite, type Invite } from "./api";
import { OnceSecret } from "./reset-password-dialog";
import { S } from "./strings";

const F = S.invites.form;

/** 新建邀请码:标签、可用次数、到期;创建后把明文码显示一次。 */
export function CreateInviteDialog({ open, onClose, onCreated }: { open: boolean; onClose: () => void; onCreated: (invite: Invite) => void }) {
  const [label, setLabel] = useState("");
  const [maxUses, setMaxUses] = useState("10");
  const [expires, setExpires] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [code, setCode] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setLabel("");
      setMaxUses("10");
      setExpires("");
      setError(null);
      setBusy(false);
      setCode(null);
    }
  }, [open]);

  const submit = async () => {
    const n = Number(maxUses);
    if (!Number.isInteger(n) || n < 1 || n > 1000) {
      setError(F.invalidUses);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const r = await createInvite({ label: label.trim(), maxUses: n, expiresAt: expires ? new Date(expires).toISOString() : null });
      setCode(r.code);
      onCreated(r.invite);
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  };

  if (!open) return null;
  if (code !== null) {
    return (
      <Dialog
        open
        title={S.invites.created.title}
        onClose={() => undefined}
        footer={
          <button type="button" className="btn-primary btn-sm" onClick={onClose}>
            {S.invites.created.close}
          </button>
        }
      >
        <p className="leading-relaxed text-fg-2">{S.invites.created.once}</p>
        <OnceSecret value={code} copyLabel={S.invites.created.copy} copiedLabel={S.invites.created.copied} />
      </Dialog>
    );
  }
  return (
    <Dialog
      open
      title={F.title}
      onClose={busy ? () => undefined : onClose}
      footer={
        <>
          <button type="button" className="btn-ghost btn-sm" onClick={onClose} disabled={busy}>
            {Shell.dialogs.cancel}
          </button>
          <button type="button" className="btn-primary btn-sm" onClick={() => void submit()} disabled={busy}>
            {busy && <SpinnerIcon width={14} height={14} />}
            {F.submit}
          </button>
        </>
      }
    >
      <label className="block space-y-1">
        <span className="text-xs font-medium text-fg-2">{F.label}</span>
        <input className="field-sm" maxLength={64} value={label} placeholder={F.labelHint} onChange={(e) => setLabel(e.target.value)} />
      </label>
      <div className="grid grid-cols-2 gap-3">
        <label className="block space-y-1">
          <span className="text-xs font-medium text-fg-2">{F.maxUses}</span>
          <input className="field-sm num" inputMode="numeric" value={maxUses} onChange={(e) => setMaxUses(e.target.value)} />
        </label>
        <label className="block space-y-1">
          <span className="text-xs font-medium text-fg-2">{F.expires}</span>
          <input className="field-sm" type="datetime-local" value={expires} onChange={(e) => setExpires(e.target.value)} />
        </label>
      </div>
      {error && (
        <p role="alert" className="rounded-lg border border-bad/30 bg-bad-soft px-3 py-2 text-bad">
          {error}
        </p>
      )}
    </Dialog>
  );
}
