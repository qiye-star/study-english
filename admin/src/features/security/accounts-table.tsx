import { useState } from "react";
import type { Role } from "../../api/session";
import { ConfirmDialog } from "../../components/confirm-dialog";
import { DataTable, type Column } from "../../components/data-table";
import { Dialog } from "../../components/dialog";
import { StatusDot } from "../../components/status-dot";
import { errorText } from "../../hooks/use-async";
import { formatRelative } from "../../lib/format";
import { S as Shell } from "../../strings";
import { resetTotp, updateAccount, type AdminAccount } from "./api";
import { MIN_PASSWORD } from "./create-account-dialog";
import { S } from "./strings";

type Pending =
  | { kind: "role"; account: AdminAccount; role: Role }
  | { kind: "disable" | "enable" | "totp"; account: AdminAccount }
  | null;

const ROLES: Role[] = ["viewer", "operator", "superadmin"];

/** 账号表(超级管理员):env 应急账号固定第一行、带"应急"标签、不可编辑;库内账号可改角色/停用/重置 TOTP/重置密码。 */
export function AccountsTable({ accounts, onChanged }: { accounts: AdminAccount[]; onChanged: () => void }) {
  const [pending, setPending] = useState<Pending>(null);
  const [passwordFor, setPasswordFor] = useState<AdminAccount | null>(null);

  const act = async () => {
    if (!pending || pending.account.id === null) return;
    const id = pending.account.id;
    if (pending.kind === "role") await updateAccount(id, { role: pending.role });
    else if (pending.kind === "totp") await resetTotp(id);
    else await updateAccount(id, { disabled: pending.kind === "disable" });
    setPending(null);
    onChanged();
  };

  const columns: Column<AdminAccount>[] = [
    {
      key: "username",
      header: S.cols.username,
      render: (a) => (
        <span className="inline-flex items-center gap-2">
          <span className="font-mono">{a.username}</span>
          {a.env && (
            <span className="badge bg-warn-soft text-warn" title={S.emergencyHint}>
              {S.emergency}
            </span>
          )}
        </span>
      ),
    },
    {
      key: "role",
      header: S.cols.role,
      render: (a) =>
        a.env ? (
          Shell.shell.roles[a.role]
        ) : (
          <select
            className="field-sm h-8 w-auto"
            aria-label={S.roleOf(a.username)}
            value={a.role}
            onChange={(e) => setPending({ kind: "role", account: a, role: e.target.value as Role })}
          >
            {ROLES.map((r) => (
              <option key={r} value={r}>
                {Shell.shell.roles[r]}
              </option>
            ))}
          </select>
        ),
    },
    { key: "totp", header: S.cols.totp, render: (a) => <StatusDot tone={a.totp ? "good" : "neutral"} label={a.totp ? S.totpOn : S.totpOff} /> },
    { key: "status", header: S.cols.status, render: (a) => <StatusDot tone={a.disabled ? "warn" : "good"} label={a.disabled ? S.disabled : S.active} /> },
    { key: "last", header: S.cols.lastLogin, render: (a) => (a.env ? "—" : <span className="num text-fg-2">{formatRelative(a.lastLoginAt)}</span>) },
    {
      key: "actions",
      header: S.cols.actions,
      align: "right",
      render: (a) =>
        a.env ? null : (
          <span className="inline-flex gap-1.5">
            <button type="button" className="btn-ghost btn-sm" onClick={() => setPasswordFor(a)}>
              {S.resetPassword}
            </button>
            {a.totp && (
              <button type="button" className="btn-ghost btn-sm" onClick={() => setPending({ kind: "totp", account: a })}>
                {S.resetTotp}
              </button>
            )}
            {a.disabled ? (
              <button type="button" className="btn-ghost btn-sm" onClick={() => setPending({ kind: "enable", account: a })}>
                {S.enable}
              </button>
            ) : (
              <button type="button" className="btn-danger btn-sm" onClick={() => setPending({ kind: "disable", account: a })}>
                {S.disable}
              </button>
            )}
          </span>
        ),
    },
  ];

  const title = !pending
    ? ""
    : pending.kind === "role"
      ? S.confirmRole(pending.account.username, Shell.shell.roles[pending.role])
      : pending.kind === "totp"
        ? S.confirmResetTotp(pending.account.username)
        : pending.kind === "disable"
          ? S.confirmDisable(pending.account.username)
          : S.confirmEnable(pending.account.username);
  const body = pending?.kind === "disable" ? S.confirmDisableBody : pending?.kind === "totp" ? S.confirmResetTotpBody : undefined;

  return (
    <>
      <DataTable columns={columns} rows={accounts} rowKey={(a) => (a.env ? "env" : String(a.id))} empty="" caption={S.accounts} />
      <ConfirmDialog
        open={pending !== null}
        title={title}
        body={body}
        danger={pending?.kind === "disable" || pending?.kind === "totp"}
        onConfirm={act}
        onClose={() => setPending(null)}
      />
      {passwordFor && <PasswordDialog account={passwordFor} onClose={() => setPasswordFor(null)} onDone={() => { setPasswordFor(null); onChanged(); }} />}
    </>
  );
}

function PasswordDialog({ account, onClose, onDone }: { account: AdminAccount; onClose: () => void; onDone: () => void }) {
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const ok = password.length >= MIN_PASSWORD;
  const submit = async () => {
    if (!ok || busy || account.id === null) return;
    setBusy(true);
    setError(null);
    try {
      await updateAccount(account.id, { password });
      onDone();
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog
      open
      title={S.passwordTitle(account.username)}
      onClose={busy ? () => undefined : onClose}
      footer={
        <>
          <button type="button" className="btn-ghost btn-sm" onClick={onClose} disabled={busy}>
            {Shell.dialogs.cancel}
          </button>
          <button type="button" className="btn-primary btn-sm" onClick={submit} disabled={!ok || busy}>
            {Shell.dialogs.confirm}
          </button>
        </>
      }
    >
      <p className="text-fg-2">{S.passwordBody}</p>
      <label className="block space-y-1">
        <span className="text-xs font-medium text-fg-2">{S.newPassword}</span>
        <input className="field-sm" type="password" autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} />
      </label>
      {error && (
        <p role="alert" className="rounded-lg border border-bad/30 bg-bad-soft px-3 py-2 text-bad">
          {error}
        </p>
      )}
    </Dialog>
  );
}
