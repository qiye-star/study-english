import { useEffect, useState } from "react";
import { ConfirmDialog } from "../../components/confirm-dialog";
import { RoleGate } from "../../components/role-gate";
import { StatusDot } from "../../components/status-dot";
import { hasRole, useAdminSession } from "../../api/session";
import { errorText } from "../../hooks/use-async";
import { formatDateTime } from "../../lib/format";
import { disableUser, enableUser, getUserStatus, revokeTokens } from "./api";
import { DeleteUserDialog } from "./delete-user-dialog";
import { QuotaTable } from "./quota-table";
import { ResetPasswordDialog } from "./reset-password-dialog";
import { S } from "./strings";

type Open = null | "disable" | "enable" | "revoke" | "reset" | "delete";

/**
 * 用户详情页「治理」页签(spec §7):状态卡 + 停用/启用、撤销登录、重置密码、删除(仅超级管理员)+ 配额覆盖。
 * 用户详情页只传 userId 时自行读取用户名与停用状态。写操作需要 operator(服务端另有校验)。
 */
export function UserAdminPanel({ userId, username: givenName, disabledAt: givenDisabled }: {
  userId: string | number;
  username?: string;
  disabledAt?: string | null;
}) {
  const session = useAdminSession();
  const [username, setUsername] = useState(givenName ?? "");
  const [disabledAt, setDisabledAt] = useState<string | null>(givenDisabled ?? null);
  const [open, setOpen] = useState<Open>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const operator = hasRole(session, "operator");

  useEffect(() => {
    if (givenName !== undefined) return;
    let live = true;
    getUserStatus(userId).then(
      (u) => {
        if (!live || !u) return;
        setUsername(u.username);
        setDisabledAt(u.disabledAt);
      },
      (e) => live && setLoadError(errorText(e)),
    );
    return () => {
      live = false;
    };
  }, [userId, givenName]);

  const close = () => setOpen(null);
  const disabled = disabledAt !== null;

  return (
    <div className="space-y-4" aria-label={S.userAdminPanel}>
      <section className="panel flex items-center justify-between gap-4 px-4 py-3.5" aria-label={S.status.title}>
        <div className="min-w-0">
          <p className="eyebrow">{S.status.title}</p>
          <p className="mt-1 text-base font-semibold">
            <StatusDot tone={disabled ? "bad" : "good"} label={disabled ? S.status.disabled : S.status.active} />
          </p>
          <p className="mt-0.5 text-xs text-muted">
            {disabled ? S.status.disabledAt(formatDateTime(disabledAt)) : S.status.activeHint}
            {disabled && ` · ${S.status.disabledHint}`}
          </p>
        </div>
        {operator && (
          <div className="flex flex-wrap justify-end gap-2">
            {disabled ? (
              <button type="button" className="btn-ghost btn-sm" onClick={() => setOpen("enable")}>
                {S.actions.enable}
              </button>
            ) : (
              <button type="button" className="btn-danger btn-sm" onClick={() => setOpen("disable")}>
                {S.actions.disable}
              </button>
            )}
            <button type="button" className="btn-ghost btn-sm" onClick={() => setOpen("revoke")}>
              {S.actions.revoke}
            </button>
            <button type="button" className="btn-ghost btn-sm" onClick={() => setOpen("reset")}>
              {S.actions.reset}
            </button>
            <RoleGate min="superadmin">
              <button type="button" className="btn-danger btn-sm" disabled={!username} onClick={() => setOpen("delete")}>
                {S.actions.delete}
              </button>
            </RoleGate>
          </div>
        )}
      </section>

      {loadError && (
        <p role="alert" className="text-sm text-bad">
          {loadError}
        </p>
      )}
      {message && (
        <p role="status" className="rounded-lg bg-good-soft px-3 py-2 text-sm text-good">
          {message}
        </p>
      )}

      {operator && <QuotaTable userId={userId} />}

      <ConfirmDialog
        open={open === "disable"}
        danger
        title={S.disable.title}
        body={S.disable.body}
        reasonRequired
        onClose={close}
        onConfirm={async (reason) => {
          const r = await disableUser(userId, reason);
          setDisabledAt(r?.disabledAt ?? new Date().toISOString());
          setMessage(S.disable.done(r?.revoked ?? 0));
          close();
        }}
      />
      <ConfirmDialog
        open={open === "enable"}
        title={S.enable.title}
        body={S.enable.body}
        reasonRequired
        onClose={close}
        onConfirm={async (reason) => {
          await enableUser(userId, reason);
          setDisabledAt(null);
          setMessage(S.enable.done);
          close();
        }}
      />
      <ConfirmDialog
        open={open === "revoke"}
        title={S.revoke.title}
        body={S.revoke.body}
        onClose={close}
        onConfirm={async () => {
          const n = await revokeTokens(userId);
          setMessage(S.revoke.done(n ?? 0));
          close();
        }}
      />
      <ResetPasswordDialog open={open === "reset"} userId={userId} onClose={close} />
      {open === "delete" && <DeleteUserDialog open userId={userId} username={username} onClose={close} />}
    </div>
  );
}
