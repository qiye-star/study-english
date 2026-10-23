import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { listUsers, type UserEmailFilter, type UserRow, type UserSort, type UserStatusFilter } from "../features/users/api";
import { S as U } from "../features/users/strings";
import { Avatar } from "../components/avatar";
import { ChevronIcon, SearchIcon } from "../components/icons";
import { Chips, Screen, TOP_BAR_H, TopBar } from "../components/layout";
import { PagedList } from "../components/states";
import { usePaged } from "../hooks/use-paged";
import { formatBytes, formatRelative } from "../lib/format";
import { S } from "../strings";

export function UserCard({ user }: { user: UserRow }) {
  return (
    <li>
      <Link to={`/users/${encodeURIComponent(user.id)}`} className="row-link">
        <Avatar name={user.username} />
        <div className="min-w-0 flex-1">
          <p className="flex items-center gap-2 truncate text-base font-semibold leading-tight">
            {user.username}
            {user.disabled_at && <span className="badge bg-bad-soft text-bad">{U.list.disabledBadge}</span>}
          </p>
          <p className="mt-0.5 flex min-w-0 items-center gap-2 text-xs text-muted">
            {user.email_masked ? (
              <>
                <span className="num min-w-0 truncate">{user.email_masked}</span>
                <span className={`badge shrink-0 ${user.email_verified ? "bg-good-soft text-good" : "bg-warn-soft text-warn"}`}>
                  {user.email_verified ? U.email.verified : U.email.unverified}
                </span>
              </>
            ) : (
              <span className="badge shrink-0 bg-sunken text-fg-2">{U.email.unbound}</span>
            )}
          </p>
          <p className="mt-0.5 truncate text-xs text-muted">
            {S.users.lastActive} {formatRelative(user.last_active_at)}
          </p>
        </div>
        <dl className="num shrink-0 text-right text-xs leading-tight text-muted">
          <div className="flex justify-end gap-2">
            <span>
              <dd className="inline font-medium text-fg">{user.conversations}</dd> <dt className="inline">{S.users.conversations}</dt>
            </span>
            <span>
              <dd className="inline font-medium text-fg">{user.assessments}</dd> <dt className="inline">{S.users.assessments}</dt>
            </span>
          </div>
          <div className="mt-0.5">
            <dd className="inline">{formatBytes(user.recording_bytes)}</dd>
          </div>
        </dl>
        <ChevronIcon className="shrink-0 text-line-strong" width={18} height={18} />
      </Link>
    </li>
  );
}

export function UsersPage() {
  const [input, setInput] = useState("");
  const [q, setQ] = useState("");
  useEffect(() => {
    const t = setTimeout(() => setQ(input.trim()), 300);
    return () => clearTimeout(t);
  }, [input]);

  const [status, setStatus] = useState<UserStatusFilter>("all");
  const [sort, setSort] = useState<UserSort>("recent");
  const [email, setEmail] = useState<UserEmailFilter>("all");

  const paged = usePaged<UserRow>(async (page) => {
    const r = await listUsers(q, page, { status, sort, email });
    return { items: r.users, next: r.next, total: r.total };
  }, [q, status, sort, email]);

  return (
    <>
      <TopBar title={S.users.title} subtitle={paged.total !== undefined && !paged.loading ? S.users.total(paged.total) : undefined} />
      <div className="sticky z-10 bg-bg/88 px-4 pb-2 pt-3 backdrop-blur-xl" style={{ top: `calc(${TOP_BAR_H}px + env(safe-area-inset-top))` }}>
        <label className="relative block">
          <span className="sr-only">{S.users.search}</span>
          <SearchIcon className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-muted" width={18} height={18} />
          <input
            id="user-search"
            type="search"
            inputMode="search"
            enterKeyHint="search"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder={S.users.search}
            autoCapitalize="none"
            autoCorrect="off"
            className="field h-11 pl-10"
          />
        </label>
        <div className="mt-2 flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-3">
            <Chips
              label={U.list.status}
              value={status}
              onChange={setStatus}
              options={(["all", "active", "disabled"] as const).map((v) => ({ value: v, label: U.list.statuses[v] }))}
            />
            <Chips
              label={U.email.filter}
              value={email}
              onChange={setEmail}
              options={(["all", "bound", "unbound"] as const).map((v) => ({ value: v, label: U.email.filters[v] }))}
            />
          </div>
          <label className="flex items-center gap-2 text-sm text-fg-2">
            {U.list.sort}
            <select className="field-sm w-auto" value={sort} onChange={(e) => setSort(e.target.value as UserSort)}>
              {(["recent", "created", "storage"] as const).map((v) => (
                <option key={v} value={v}>
                  {U.list.sorts[v]}
                </option>
              ))}
            </select>
          </label>
        </div>
      </div>
      <Screen className="pt-2">
        <PagedList paged={paged} empty={q ? S.users.emptySearch : S.users.empty}>
          {(items) => items.map((u) => <UserCard key={u.id} user={u} />)}
        </PagedList>
      </Screen>
    </>
  );
}
