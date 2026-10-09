import { useState } from "react";
import * as session from "../../api/session";
import { hasRole, useAdminSession } from "../../api/session";
import { Page } from "../../components/layout";
import { ErrorState, Skeleton } from "../../components/states";
import { useAsync } from "../../hooks/use-async";
import { getMySecurity, listAccounts } from "./api";
import { AccountsTable } from "./accounts-table";
import { CreateAccountDialog } from "./create-account-dialog";
import { PasswordCard } from "./password-card";
import { SessionsList } from "./sessions-list";
import { S } from "./strings";
import { TotpCard } from "./totp-card";

function AccountsSection() {
  const [tick, setTick] = useState(0);
  const [creating, setCreating] = useState(false);
  const accounts = useAsync(listAccounts, [tick]);
  return (
    <section aria-label={S.accounts} className="panel">
      <div className="panel-head">
        <h2 className="text-md font-semibold">{S.accounts}</h2>
        <button type="button" className="btn-primary btn-sm" onClick={() => setCreating(true)}>
          {S.newAccount}
        </button>
      </div>
      <div className="px-1 pb-2">
        {accounts.error ? (
          <ErrorState message={accounts.error} onRetry={accounts.reload} />
        ) : !accounts.data ? (
          <Skeleton rows={2} />
        ) : (
          <AccountsTable accounts={accounts.data} onChanged={() => setTick((t) => t + 1)} />
        )}
      </div>
      {creating && (
        <CreateAccountDialog
          onClose={() => setCreating(false)}
          onCreated={() => {
            setCreating(false);
            setTick((t) => t + 1);
          }}
        />
      )}
    </section>
  );
}

/** 管理员与会话(spec §4):超级管理员看到账号表;所有人看到"我的会话""两步验证""修改密码"。 */
export function SecurityPage() {
  const current = useAdminSession();
  const superadmin = hasRole(current, "superadmin");
  const [tick, setTick] = useState(0);
  const me = useAsync(getMySecurity, [tick]);

  return (
    <Page title={S.securityPage}>
      {superadmin && <AccountsSection />}
      <SessionsList canSeeAll={superadmin} onRevokedCurrent={() => session.clearSession()} />
      {me.error ? (
        <ErrorState message={me.error} onRetry={me.reload} />
      ) : !me.data ? (
        <Skeleton rows={2} />
      ) : (
        <div className="grid grid-cols-2 items-start gap-4">
          <TotpCard
            me={me.data}
            onChanged={() => {
              setTick((t) => t + 1);
              void session.refreshSession();
            }}
          />
          <PasswordCard me={me.data} />
        </div>
      )}
    </Page>
  );
}
