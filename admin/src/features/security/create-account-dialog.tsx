import { useState } from "react";
import type { Role } from "../../api/session";
import { Dialog } from "../../components/dialog";
import { SpinnerIcon } from "../../components/icons";
import { errorText } from "../../hooks/use-async";
import { S as Shell } from "../../strings";
import { createAccount, type AdminAccount } from "./api";
import { S } from "./strings";

export const USERNAME_RE = /^[a-z0-9_.-]{3,32}$/;
export const MIN_PASSWORD = 12;
const ROLES: Role[] = ["viewer", "operator", "superadmin"];

/** 新建库内管理员(超级管理员;服务端要求二次验证,由客户端自动弹出)。 */
export function CreateAccountDialog({ onClose, onCreated }: { onClose: () => void; onCreated: (a: AdminAccount) => void }) {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [role, setRole] = useState<Role>("viewer");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const name = username.trim().toLowerCase();
  const nameOk = USERNAME_RE.test(name);
  const passwordOk = password.length >= MIN_PASSWORD;

  const submit = async () => {
    if (!nameOk || !passwordOk || busy) return;
    setBusy(true);
    setError(null);
    try {
      onCreated(await createAccount({ username: name, password, role }));
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog
      open
      title={S.newAccount}
      onClose={busy ? () => undefined : onClose}
      footer={
        <>
          <button type="button" className="btn-ghost btn-sm" onClick={onClose} disabled={busy}>
            {Shell.dialogs.cancel}
          </button>
          <button type="button" className="btn-primary btn-sm" onClick={submit} disabled={!nameOk || !passwordOk || busy}>
            {busy && <SpinnerIcon width={14} height={14} />}
            {S.create}
          </button>
        </>
      }
    >
      <div className="space-y-1">
        <label className="block space-y-1">
          <span className="text-xs font-medium text-fg-2">{S.username}</span>
          <input className="field-sm font-mono" value={username} onChange={(e) => setUsername(e.target.value)} autoComplete="off" spellCheck={false} />
        </label>
        {username && !nameOk && <p className="text-2xs text-bad">{S.usernameRule}</p>}
      </div>
      <div className="space-y-1">
        <label className="block space-y-1">
          <span className="text-xs font-medium text-fg-2">{S.password}</span>
          <input className="field-sm" type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="new-password" />
        </label>
        {password && !passwordOk && <p className="text-2xs text-bad">{S.passwordRule}</p>}
      </div>
      <label className="block space-y-1">
        <span className="text-xs font-medium text-fg-2">{S.role}</span>
        <select className="field-sm" value={role} onChange={(e) => setRole(e.target.value as Role)}>
          {ROLES.map((r) => (
            <option key={r} value={r}>
              {Shell.shell.roles[r]}
            </option>
          ))}
        </select>
      </label>
      {error && (
        <p role="alert" className="rounded-lg border border-bad/30 bg-bad-soft px-3 py-2 text-bad">
          {error}
        </p>
      )}
    </Dialog>
  );
}
