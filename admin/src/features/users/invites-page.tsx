import { useState } from "react";
import { ConfirmDialog } from "../../components/confirm-dialog";
import { DataTable, type Column } from "../../components/data-table";
import { Page } from "../../components/layout";
import { ErrorState, Skeleton } from "../../components/states";
import { useAsync } from "../../hooks/use-async";
import { formatDateTime } from "../../lib/format";
import { listInvites, revokeInvite, type Invite, type InviteState } from "./api";
import { CreateInviteDialog } from "./create-invite-dialog";
import { S } from "./strings";

const I = S.invites;
const BADGE: Record<InviteState, string> = {
  active: "bg-good-soft text-good",
  used_up: "bg-sunken text-fg-2",
  expired: "bg-warn-soft text-warn",
  revoked: "bg-sunken text-muted",
};

/** /invites:多用途邀请码(spec §7)。明文只在创建时显示一次;列表只有标签、次数、到期与状态。 */
export function InvitesPage() {
  const { data, error, reload } = useAsync(() => listInvites(), []);
  const [creating, setCreating] = useState(false);
  const [revoking, setRevoking] = useState<Invite | null>(null);

  const columns: Column<Invite>[] = [
    { key: "label", header: I.label, render: (r) => <span className="font-medium">{r.label || "—"}</span> },
    { key: "uses", header: I.uses, numeric: true, render: (r) => `${r.uses} / ${r.maxUses}` },
    { key: "expires", header: I.expires, render: (r) => <span className="num text-fg-2">{r.expiresAt ? formatDateTime(r.expiresAt) : I.never}</span> },
    { key: "state", header: I.state, render: (r) => <span className={`badge ${BADGE[r.state]}`}>{I.states[r.state] ?? r.state}</span> },
    { key: "by", header: I.createdBy, render: (r) => <span className="text-fg-2">{r.createdBy}</span> },
    { key: "at", header: I.createdAt, render: (r) => <span className="num text-fg-2">{formatDateTime(r.createdAt)}</span> },
    {
      key: "actions",
      header: I.actions,
      align: "right",
      render: (r) =>
        r.state === "revoked" ? null : (
          <button type="button" className="btn-quiet btn-sm" onClick={() => setRevoking(r)}>
            {I.revoke}
          </button>
        ),
    },
  ];

  return (
    <Page
      title={I.title}
      actions={
        <button type="button" className="btn-primary btn-sm" onClick={() => setCreating(true)}>
          {I.create}
        </button>
      }
    >
      <p className="text-sm text-fg-2">{I.hint}</p>
      {error ? (
        <ErrorState message={error} onRetry={reload} />
      ) : !data ? (
        <Skeleton rows={3} />
      ) : (
        <div className="panel">
          <DataTable columns={columns} rows={data} empty={I.empty} rowKey={(r) => r.id} caption={I.title} />
        </div>
      )}
      <CreateInviteDialog
        open={creating}
        onClose={() => {
          setCreating(false);
          reload();
        }}
        onCreated={() => undefined}
      />
      <ConfirmDialog
        open={revoking !== null}
        danger
        title={I.revokeTitle}
        body={revoking ? I.revokeBody(revoking.label) : undefined}
        confirmText={I.revoke}
        onClose={() => setRevoking(null)}
        onConfirm={async () => {
          if (revoking) await revokeInvite(revoking.id);
          setRevoking(null);
          reload();
        }}
      />
    </Page>
  );
}
