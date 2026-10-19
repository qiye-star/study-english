import { Dialog } from "../../components/dialog";
import { DataTable, type Column } from "../../components/data-table";
import { ErrorState, Skeleton } from "../../components/states";
import { useAsync } from "../../hooks/use-async";
import { formatDateTime } from "../../lib/format";
import { listRedemptions, type Invite, type Redemption } from "./api";
import { S } from "./strings";

const R = S.invites.redemptionsDialog;

/** 一个邀请码的兑换明细(谁、何时、账号是否已停用)。身份以登录名为主(X6)。 */
export function InviteRedemptionsDialog({ invite, onClose }: { invite: Invite | null; onClose: () => void }) {
  const { data, error, reload } = useAsync<Redemption[]>(
    () => (invite ? listRedemptions(invite.id) : Promise.resolve([])),
    [invite?.id ?? null],
  );
  if (!invite) return null;

  const columns: Column<Redemption>[] = [
    { key: "username", header: R.username, render: (r) => <span className="font-medium">{r.username ?? "—"}</span> },
    { key: "nickname", header: R.nickname, render: (r) => <span className="text-fg-2">{r.nickname ?? "—"}</span> },
    { key: "at", header: R.redeemedAt, render: (r) => <span className="num text-fg-2">{formatDateTime(r.redeemedAt)}</span> },
    {
      key: "status",
      header: R.status,
      render: (r) =>
        r.userId === null ? <span className="text-muted">{R.deleted}</span> : r.disabled ? <span className="badge bg-warn-soft text-warn">{R.disabled}</span> : null,
    },
  ];

  return (
    <Dialog
      open
      title={R.title(invite.label)}
      onClose={onClose}
      width={640}
      footer={
        <button type="button" className="btn-ghost btn-sm" onClick={onClose}>
          {R.close}
        </button>
      }
    >
      {error ? (
        <ErrorState message={error} onRetry={reload} />
      ) : !data ? (
        <Skeleton rows={2} />
      ) : (
        <DataTable columns={columns} rows={data} empty={R.empty} rowKey={(r) => `${r.redeemedAt}-${r.userId ?? "gone"}`} caption={R.title(invite.label)} />
      )}
    </Dialog>
  );
}
