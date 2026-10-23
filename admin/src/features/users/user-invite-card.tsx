import { useState } from "react";
import { Link } from "react-router-dom";
import { hasRole, useAdminSession } from "../../api/session";
import { ConfirmDialog } from "../../components/confirm-dialog";
import { Skeleton } from "../../components/states";
import { useAsync } from "../../hooks/use-async";
import { formatDateTime } from "../../lib/format";
import { getUserInvite, revokeUserInvite, rotateUserInvite, type InviteState, type UserInviteStatus } from "./api";
import { S } from "./strings";

const C = S.invites.userCard;
/** 用户码的累计上限配额键(服务端 user_invites.CAP_KEY);「调整上限」跳到配额表的这一行。 */
const CAP_KEY = "invites_user_code_max_uses";
const BADGE: Record<InviteState, string> = {
  active: "bg-good-soft text-good",
  used_up: "bg-sunken text-fg-2",
  expired: "bg-warn-soft text-warn",
  revoked: "bg-sunken text-muted",
};

/**
 * 用户详情页的邀请码卡片:用量、历史码与被停用的被邀请者数;收回 / 更换需要 operator 与原因。
 * 卡片从不显示码本身(R-I10):读取接口根本不返回码。只对 operator 显示(读取接口也要求 operator)。
 */
export function UserInviteCard({ userId }: { userId: string | number }) {
  const session = useAdminSession();
  const operator = hasRole(session, "operator");
  const { data, error, reload } = useAsync<UserInviteStatus | null>(
    () => (operator ? getUserInvite(userId) : Promise.resolve(null)),
    [userId, operator],
  );
  const [open, setOpen] = useState<null | "revoke" | "replace">(null);
  const [message, setMessage] = useState<string | null>(null);

  if (!operator) return null;
  const current = data?.current ?? null;

  return (
    <section className="panel space-y-2 px-4 py-3.5" aria-label={C.title}>
      <p className="eyebrow">{C.title}</p>
      {error && (
        <p role="alert" className="text-sm text-bad">
          {error}
        </p>
      )}
      {!data && !error && <Skeleton rows={1} />}
      {data && (
        <>
          {current ? (
            <p className="mt-1 flex flex-wrap items-center gap-2 text-base font-semibold">
              <span className="num">{C.usage(current.uses, current.cap)}</span>
              <span className={`badge ${BADGE[current.state]}`}>{S.invites.states[current.state] ?? current.state}</span>
            </p>
          ) : (
            <p className="mt-1 text-base font-semibold text-muted">{C.none}</p>
          )}
          {current && <p className="text-xs text-muted">{C.createdAt(formatDateTime(current.createdAt))}</p>}
          <p className="text-xs text-muted">{C.summary(data.historyCodes, data.redemptions, data.disabledInvitees)}</p>
          {message && (
            <p role="status" className="rounded-lg bg-good-soft px-3 py-2 text-sm text-good">
              {message}
            </p>
          )}
          <div className="flex flex-wrap items-center gap-2 pt-1">
            <button type="button" className="btn-danger btn-sm" disabled={!current} onClick={() => setOpen("revoke")}>
              {C.revoke}
            </button>
            <button type="button" className="btn-ghost btn-sm" disabled={!current} onClick={() => setOpen("replace")}>
              {C.replace}
            </button>
            <Link to={`?tab=admin#quota-${CAP_KEY}`} className="btn-ghost btn-sm">
              {C.adjustCap}
            </Link>
          </div>
          <p className="text-xs text-muted">{C.adjustHint}</p>
        </>
      )}
      <ConfirmDialog
        open={open === "revoke"}
        danger
        title={C.revokeTitle}
        body={C.revokeBody}
        confirmText={C.revoke}
        reasonRequired
        onClose={() => setOpen(null)}
        onConfirm={async (reason) => {
          await revokeUserInvite(userId, reason);
          setMessage(C.revoked);
          setOpen(null);
          reload();
        }}
      />
      <ConfirmDialog
        open={open === "replace"}
        title={C.replaceTitle}
        body={C.replaceBody}
        confirmText={C.replace}
        reasonRequired
        onClose={() => setOpen(null)}
        onConfirm={async (reason) => {
          await rotateUserInvite(userId, reason);
          setMessage(C.replaced);
          setOpen(null);
          reload();
        }}
      />
    </section>
  );
}
