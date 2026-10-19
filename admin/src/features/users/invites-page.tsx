import { useState } from "react";
import { ConfirmDialog } from "../../components/confirm-dialog";
import { DataTable, type Column } from "../../components/data-table";
import { Page } from "../../components/layout";
import { ErrorState, Skeleton } from "../../components/states";
import { useAsync } from "../../hooks/use-async";
import { formatDateTime } from "../../lib/format";
import { listInvites, revokeInvite, type Invite, type InviteFilter, type InviteState } from "./api";
import { BatchInviteDialog } from "./batch-invite-dialog";
import { CreateInviteDialog } from "./create-invite-dialog";
import { InviteRedemptionsDialog } from "./invite-redemptions-dialog";
import { S } from "./strings";

const I = S.invites;
const BADGE: Record<InviteState, string> = {
  active: "bg-good-soft text-good",
  used_up: "bg-sunken text-fg-2",
  expired: "bg-warn-soft text-warn",
  revoked: "bg-sunken text-muted",
};
const STATES: InviteState[] = ["active", "used_up", "expired", "revoked"];

/** /invites:管理员码(多用途 / 批量一次性)与用户码的列表,可按种类、状态、所有者筛选(spec §7, A1)。明文只在创建时显示一次。 */
export function InvitesPage() {
  const [filter, setFilter] = useState<InviteFilter>({ kind: "all", state: "all", owner: "" });
  const [ownerDraft, setOwnerDraft] = useState("");
  const { data, error, reload } = useAsync(() => listInvites(filter), [filter]);
  const [creating, setCreating] = useState(false);
  const [batching, setBatching] = useState(false);
  const [revoking, setRevoking] = useState<Invite | null>(null);
  const [redeeming, setRedeeming] = useState<Invite | null>(null);

  const columns: Column<Invite>[] = [
    { key: "label", header: I.label, render: (r) => <span className="font-medium">{r.label || "—"}</span> },
    { key: "kind", header: I.kind, render: (r) => <span className="badge bg-sunken text-fg-2">{I.kinds[r.kind] ?? r.kind}</span> },
    {
      key: "owner",
      header: I.owner,
      render: (r) =>
        r.owner ? (
          <span className="block min-w-0">
            <span className="block font-medium">{r.owner.username}</span>
            {r.owner.nickname && <span className="block truncate text-xs text-fg-2">{r.owner.nickname}</span>}
          </span>
        ) : (
          <span className="text-muted">{I.ownerNone}</span>
        ),
    },
    { key: "uses", header: I.uses, numeric: true, render: (r) => `${r.uses} / ${r.maxUses}` },
    {
      key: "redeemers",
      header: I.redeemers,
      render: (r) =>
        r.redeemers.total === 0 ? (
          <span className="text-muted">{I.redeemersNone}</span>
        ) : (
          <span className="block">
            <span className="block num">{I.redeemersCount(r.redeemers.total)}</span>
            {r.redeemers.usernames.length > 0 && <span className="block truncate text-xs text-fg-2">{r.redeemers.usernames.join("、")}</span>}
          </span>
        ),
    },
    { key: "expires", header: I.expires, render: (r) => <span className="num text-fg-2">{r.expiresAt ? formatDateTime(r.expiresAt) : I.never}</span> },
    { key: "state", header: I.state, render: (r) => <span className={`badge ${BADGE[r.state]}`}>{I.states[r.state] ?? r.state}</span> },
    { key: "by", header: I.createdBy, render: (r) => <span className="text-fg-2">{r.createdBy}</span> },
    { key: "at", header: I.createdAt, render: (r) => <span className="num text-fg-2">{formatDateTime(r.createdAt)}</span> },
    {
      key: "actions",
      header: I.actions,
      align: "right",
      render: (r) => (
        <span className="flex flex-wrap justify-end gap-1">
          <button type="button" className="btn-quiet btn-sm" onClick={() => setRedeeming(r)}>
            {I.redemptions}
          </button>
          {/* 用户码只能在该用户的卡片上收回(会写入带原因的审计),这里只管理员码 */}
          {r.kind === "admin" && r.state !== "revoked" && (
            <button type="button" className="btn-quiet btn-sm" onClick={() => setRevoking(r)}>
              {I.revoke}
            </button>
          )}
        </span>
      ),
    },
  ];

  return (
    <Page
      title={I.title}
      actions={
        <div className="flex flex-wrap justify-end gap-2">
          <button type="button" className="btn-ghost btn-sm" onClick={() => setBatching(true)}>
            {I.batch}
          </button>
          <button type="button" className="btn-primary btn-sm" onClick={() => setCreating(true)}>
            {I.create}
          </button>
        </div>
      }
    >
      <p className="text-sm text-fg-2">{I.hint}</p>
      <form
        role="search"
        className="flex flex-wrap items-end gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          setFilter((f) => ({ ...f, owner: ownerDraft.trim() }));
        }}
      >
        <select aria-label={I.kind} className="field-sm w-auto" value={filter.kind} onChange={(e) => setFilter((f) => ({ ...f, kind: e.target.value as InviteFilter["kind"] }))}>
          <option value="all">{I.kindAll}</option>
          <option value="admin">{I.kinds.admin}</option>
          <option value="user">{I.kinds.user}</option>
        </select>
        <select aria-label={I.state} className="field-sm w-auto" value={filter.state} onChange={(e) => setFilter((f) => ({ ...f, state: e.target.value as InviteFilter["state"] }))}>
          <option value="all">{I.stateAll}</option>
          {STATES.map((s) => (
            <option key={s} value={s}>
              {I.states[s]}
            </option>
          ))}
        </select>
        <label className="block space-y-1">
          <span className="text-xs font-medium text-fg-2">{I.owner}</span>
          <input className="field-sm" value={ownerDraft} placeholder={I.ownerPlaceholder} onChange={(e) => setOwnerDraft(e.target.value)} />
        </label>
        <button type="submit" className="btn-ghost btn-sm">
          {I.filter}
        </button>
      </form>
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
      <BatchInviteDialog
        open={batching}
        onClose={() => {
          setBatching(false);
          reload();
        }}
        onCreated={() => undefined}
      />
      <InviteRedemptionsDialog invite={redeeming} onClose={() => setRedeeming(null)} />
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
